On a locked-down landing zone, your pipeline has no route to the data plane. Here is how we created and maintained a SQL login anyway, without widening a single network rule.

*Bambo Adebiyi · Cloud engineer · 31 August 2026 · ~14 min read*

> **What this covers.** For engineers running Terraform against Azure landing zones where the data plane is deliberately closed to the build fleet. Assumes you are comfortable with Terraform, Azure RBAC and Azure SQL; no prior knowledge of VM run commands is needed.
>
> - Why the obvious options all require a route that should not exist
> - Running the work on a host that already has the route, driven through Azure Resource Manager
> - The Terraform wiring, including an admin password that is never written to state
> - Four real costs of the pattern, and the permission trade you are making
> - Two traps inside the script itself
> - When to reach for something else instead

A vendor-supplied line-of-business platform sits on a managed Azure landing zone. Several environments, each its own spoke subscription. The database behind it is Azure SQL, and it is locked down the way a system of record ought to be: public network access disabled, reachable only through a private endpoint, customer-managed key for transparent data encryption, and a network security group on the SQL subnet that admits TCP 1433 from a small number of named application subnets, one of which is an admin subnet. Everything else inbound is denied.

The product needs a SQL-authenticated service account. Not a managed identity, not Entra-only. A vendor installer creates logins during setup, so the account it runs as needs real credentials, a server-level role in `master` while the schema is being deployed, and ownership rights on the database itself. Its password has to live in Key Vault where the installation team can fetch it.

And it has to be recreated automatically whenever the database is. If tearing down an environment and rebuilding it means somebody opens SSMS and types `CREATE LOGIN`, the environment is not reproducible, and every claim you have made about infrastructure as code has a hole in it exactly where the credentials are.

So: a pipeline needs to execute T-SQL against a server it has no route to.

## Three ways to give the pipeline a route, and why we did not

The reflex is to solve the connectivity problem. There are three honest ways to do that and it is worth walking each one, because the argument against them is the argument for what we did instead.

| Option | Why it does not work here | When it *is* the right call |
| --- | --- | --- |
| A SQL provider in Terraform | The provider opens a TCP connection from wherever Terraform runs, and that is the build agent. | Whenever the machine running Terraform can actually reach the database. |
| `sqlcmd` from a pipeline step | Same connection from the same place. Changing the tool does not create a route. | Same as above. The choice is about ergonomics, not reachability. |
| Add the agent subnet to the NSG | Grants a shared build fleet standing TCP access to a production database to solve a once-a-quarter problem. | With a *dedicated* agent inside the workload VNet, when you have enough data-plane work to justify owning that infrastructure. |

### Use a SQL provider in Terraform

There are good Terraform providers for SQL Server that will create a login and grant roles as first-class resources, with state and drift detection. They all work by opening a TCP connection from wherever Terraform is running. Terraform is running on the build agent. The build agent is not in one of the subnets the NSG names. The provider fails at connect, and no amount of configuration changes that.

### Run sqlcmd from a pipeline step

Same problem, one layer down. `sqlcmd`, `Invoke-Sqlcmd`, a .NET connection in a script step: they are all the data plane wearing different clothes. Dropping out of Terraform does not create a network path.

### Add the agent subnet to the NSG

This one works, which is why it deserves a real argument rather than a dismissal.

The cost is that you grant a shared, general-purpose build fleet standing TCP access to a production database, permanently, to solve a problem that occurs on a handful of applies per environment per year. The blast radius of a compromised or misused agent goes from "can deploy infrastructure" to "can open a connection to the production database". Those are not the same incident.

There is a variant that is genuinely better: put a dedicated agent inside the workload's own virtual network. If you have a lot of data-plane work to do, that is the right answer and you should do it. But it is a subnet, an agent pool, a VM or container fleet with a lifecycle, patching, scaling and its own credentials. That is a substantial amount of standing infrastructure to own, and we needed to run one script.

> **A nuance worth being precise about.** Our agents were not outside the landing zone. They sit inside it and can reach private endpoints for other things, which is how they read and write the Terraform state storage account. But "inside the landing zone" is not the same as "inside this workload's VNet", and the SQL subnet's NSG names a specific set of subnets, none of which is theirs. Network access is not a single property you either have or do not.

## There is already a machine with a route

Every one of these environments has an administrative workstation VM. It exists so engineers can reach the database with SSMS and run the vendor's own configuration tooling. It sits in the admin subnet. The admin subnet is one of the subnets the NSG names.

The question stops being "how do we give the agent a path to SQL" and becomes "how do we get our script onto a machine that already has one". And that turns out to be a question with a clean answer, because Azure gives you two entirely separate ways to talk to a virtual machine.

The **data plane** is the one everyone pictures. Packets, ports, routes, NSGs. TCP 1433 to a private endpoint lives here, and it is exactly what we do not have.

The **control plane** is Azure Resource Manager. HTTPS to `management.azure.com`, authenticated with Entra ID and authorised with Azure RBAC. Everything the pipeline already does, from creating resource groups to reading Key Vault properties, happens here.

The Azure VM run command is a control plane operation. You call ARM, ARM instructs the guest agent on the VM, the VM executes the script locally. Your caller never needs a route to the VM, and the VM's own outbound connections are made from inside the VNet, where the NSG already permits them.

So the pipeline agent never touches the database. The admin VM does, over a path the security design already sanctioned. The network posture does not move an inch.

> Two paths from the build agent to Azure SQL. The direct TCP 1433 path is blocked at the virtual network boundary by the SQL subnet's NSG. The taken path goes agent → Azure Resource Manager over HTTPS → the run command extension on the admin VM inside the VNet → Azure SQL over TCP 1433, which the NSG allows from the admin subnet. The same script, two possible transports: the dashed path is the one the security design forbids and we did not attempt; the solid path reaches the database by moving the execution rather than the permission.

## Wiring it into Terraform

The resource is a `terraform_data` with a `local-exec` provisioner. That is not elegant, and I want to be honest that a provisioner is an escape hatch rather than a design pattern. It is the right escape hatch here because the operation genuinely has no provider representation on a network Terraform cannot reach.

```hcl
resource "terraform_data" "sql_service_account" {
  triggers_replace = [time_static.sql_credentials.unix]

  provisioner "local-exec" {
    interpreter = ["/bin/bash", "-c"]
    quiet       = true

    environment = {
      SUBSCRIPTION = var.subscription_id
      VM_NAME      = module.admin_vm.name
      VM_RG        = azurerm_resource_group.vms_admin.name
      SCRIPT_PATH  = "${path.module}/scripts/bootstrap-sql-account.ps1"
      SQL_FQDN     = "${local.names.sql_server}.database.windows.net"
      DB_NAMES     = join(",", [local.names.sql_database, local.names.sql_history_db])
      ADMIN_LOGIN  = local.sql_server_local_admin
      ADMIN_PW     = ephemeral.random_password.sql_admin.result
      SVC_LOGIN    = "svc-${var.workload}-${var.environment}"
      KV_NAME      = data.azurerm_key_vault.shared.name
      SECRET_NAME  = "svc-${var.workload}-${var.environment}-password"
    }

    command = <<-EOT
      set -euo pipefail
      COMMON="--subscription $SUBSCRIPTION --resource-group $VM_RG --only-show-errors"

      # no-op if the VM is already running
      az vm start $COMMON --name "$VM_NAME" >/dev/null

      az vm run-command create $COMMON --vm-name "$VM_NAME" \
        --run-command-name "bootstrap-sql-account" \
        --script "@$SCRIPT_PATH" \
        --timeout-in-seconds 900 \
        --parameters SqlServerFqdn="$SQL_FQDN" DatabaseNames="$DB_NAMES" \
                     AdminLogin="$ADMIN_LOGIN" SvcLogin="$SVC_LOGIN" \
                     KeyVaultName="$KV_NAME" SecretName="$SECRET_NAME" \
        --protected-parameters AdminPassword="$ADMIN_PW"
    EOT
  }
}
```

Four things in there are doing more work than they look like they are.

**`--protected-parameters`** is where the admin password goes. Protected parameters are the documented channel for passing secrets to the script, and they are not returned when you read the run command back. That matters because the ordinary `--parameters` are, and showing a run command needs only `read` — which the built-in Reader role already has. Server name, login name and Key Vault name are fine there. A password is not.

**`--script "@$SCRIPT_PATH"`** keeps the PowerShell in a real file in the repository, where it gets reviewed, linted and diffed like anything else. Inline scripts inside HCL heredocs are how you end up with 300 lines of unreviewable string.

**`az vm start`** is there for a reason covered further down, and it is a no-op when the VM is already running.

**`quiet = true`** and the missing log output are the subject of the next section.

### The admin password that does not exist

The credential the script authenticates with is the SQL server's administrator login. Azure will not let you remove that account after the server is created, so the mitigation is to make it unusable: generate it at the maximum supported length, write it straight to the server, and never store it anywhere.

```hcl
ephemeral "random_password" "sql_admin" {
  length           = 128
  special          = true
  override_special = "!#$%&*()-_=+[]{}<>:?"
}

module "sql_server" {
  # ...
  administrator_login                     = local.sql_server_local_admin
  administrator_login_password_wo         = ephemeral.random_password.sql_admin.result
  administrator_login_password_wo_version = var.sql_admin_password_rotation_index
}
```

An ephemeral resource is never persisted to state, and a write-only argument is sent to the API and then forgotten. So this password lives in memory, on one machine, for the duration of one apply. It is not a secret nobody has — it crosses the wire and Azure holds it — but no retrievable copy is left behind afterwards, and there is nowhere for us to go and read it back.

Which creates an interesting constraint: the bootstrap can only authenticate as the administrator on an apply that is *also* writing that administrator password. That is what the trigger is for.

```hcl
resource "time_static" "sql_credentials" {
  triggers = {
    # recreating either database loses its service account user
    database_id         = module.sql_server.databases["main"].resource_id
    history_database_id = module.sql_server.databases["history"].resource_id
    rotation_index      = tostring(var.sql_admin_password_rotation_index)
  }
}
```

Bump the rotation index and the write-only password is rewritten, which is precisely the apply on which the bootstrap can run. Recreate a database and the same thing happens, because a recreated database has lost its users. The index is therefore the documented way to re-run the bootstrap after a failure, and rotating an admin password nothing uses costs nothing.

## What the pattern costs you

This is the part I would want to read in somebody else's article, so here it is in full.

### 1. The pipeline goes dark

Terraform suppresses *all* output from a `local-exec` provisioner that references an ephemeral value. This is correct behaviour. Terraform cannot know which line of your script's output contains the secret, so it withholds every line. But it means the moment you wire an ephemeral password into the environment block, your carefully written script output vanishes from the pipeline log, and a failing run tells you nothing but an exit code.

The fix is to write to a file and publish it as a build artifact:

```bash
SHOW="az vm run-command show $COMMON --vm-name $VM_NAME --run-command-name bootstrap-sql-account --instance-view"

OUT=$($SHOW --query "instanceView.output" -o tsv)
ERR=$($SHOW --query "instanceView.error"  -o tsv)
CODE=$($SHOW --query "instanceView.exitCode" -o tsv)

# echoing here shows nothing; the file is the only record
{ echo "exit: $CODE"; echo "--- output ---"; echo "$OUT";
  echo "--- error ---";  echo "$ERR"; } >> bootstrap.log
```

One caveat on that snippet: the `output` and `error` fields in the instance view are capped at the last 4 KB. A chatty script will have its beginning silently trimmed, which is the worst possible failure mode for a log you are reading precisely because everything else went dark. If your script says more than that, stream it to an append blob with `--output-blob-uri` instead.

Two consequences follow. The script must never print a secret, because that log is now a build artifact with a retention policy. And on failure you should deliberately leave the run command in place on the VM, so an engineer can read it directly with `az vm run-command show --instance-view` without re-running anything. Delete it only on success.

### 2. The VM has to be running

Run commands are implemented as VM extensions, and Azure refuses to create or modify an extension on a stopped machine:

```
unexpected status 409 (409 Conflict) with error: OperationNotAllowed:
Cannot modify extensions in the VM when the VM is not running.
```

Plenty of non-production environments shut their VMs down outside working hours, either through their own schedule or centrally by a platform team. So an apply that runs after hours will hit this, and it will hit it on the very first deployment somebody attempts in the evening. Hence `az vm start` at the top of the provisioner.

> **Do not use "rerun failed jobs".** If a run fails this way, start the VMs and then *queue a new run*. A pipeline that splits plan and apply into separate stages replays the saved plan artifact on rerun, and once state has moved on, that plan is stale and will be rejected. The rerun button is the natural thing to reach for and it will waste twenty minutes.

### 3. You need a retry, and a retry needs idempotence

We observed the run command extension, exactly once, invoke the script with a protected parameter unbound. The script failed with `Missing an argument for parameter 'AdminPassword'` on input that bound correctly on every other attempt before and since. I never found the root cause.

The response was two attempts rather than one. But a retry loop is only honest if re-running the script is genuinely harmless, and that is a property you have to design in rather than assume. The script is written as an *ensure*, not a *set*:

| State it finds | What it does |
| --- | --- |
| Key Vault password still authenticates, roles correct | Nothing. It does not even open an administrator connection. |
| Password authenticates, roles wrong | Corrects the roles. Leaves the password alone. |
| Login missing, or password no longer matches Key Vault | Generates a new password, applies it to SQL, then writes Key Vault, then proves the stored value authenticates. |

The sentence that made this change reviewable was "running it against a healthy environment will not rotate a password somebody is currently using". That is the property, and the retry depends on it entirely.

The ordering in the third row matters too. SQL is updated first and Key Vault second, and the run reports success only after reading the stored secret back and using it to open a real connection. A failure between those two steps leaves Key Vault stale, which the next run detects and repairs. Earlier, when Terraform wrote the Key Vault secret and the script wrote the SQL login, a half-failed apply left the two permanently out of step with nothing to detect it. That failure is silent by construction, and no amount of retry logic fixes a design with two writers.

### 4. The permission trade you are making

Run command executes as SYSTEM on the target machine. Anybody who can call `Microsoft.Compute/virtualMachines/runCommand/write` on that VM can do anything on it — a permission Virtual Machine Contributor and above already hold. Your pipeline identity almost certainly already has Contributor on the workload, so you are not adding a permission. You are making that VM a more attractive lever, and it is worth saying so out loud in the design note rather than letting a security reviewer find it.

The corresponding piece is that the script reaches Key Vault as the *VM's* system-assigned managed identity, not as the pipeline. So the VM gets the Key Vault role, the pipeline never holds the service account secret, and the two identities are separable if you later want to lock the pipeline down further.

```hcl
resource "azurerm_role_assignment" "admin_vm_kv" {
  principal_id         = module.admin_vm.system_assigned_mi_principal_id
  scope                = data.azurerm_key_vault.shared.id
  role_definition_name = "Key Vault Secrets Officer"
}

# role assignments are not immediately effective
resource "time_sleep" "wait_for_kv_rbac" {
  depends_on      = [azurerm_role_assignment.admin_vm_kv]
  create_duration = "60s"
}
```

That sleep is not superstition. Without it the first apply on a fresh environment fails with a 403 from Key Vault, in a way that looks exactly like a misconfigured role. Be aware that 60 seconds is a pragmatic floor rather than a guarantee: Microsoft documents that role assignments can take up to 10 minutes to take effect, because Azure Resource Manager caches authorization data. Sixty seconds has been enough at this scope in practice, and the retry in the previous section is what covers the case where it is not.

## Two traps inside the script itself

Neither is specific to this pattern, but both cost me real time and both are the kind of thing that reads as obvious only after you have been bitten.

### PowerShell variable names are case-insensitive

The script takes a switch as a string parameter, because run command parameters are strings. The natural thing to write is:

```powershell
param([string] $GrantLoginManager = '1')

# WRONG: writes back into the [string]-typed parameter
$grantLoginManager = @('1','true','yes') -contains $GrantLoginManager.ToLower()
```

PowerShell treats `$grantLoginManager` and `$GrantLoginManager` as the same variable. So the assignment writes back into the parameter, which is typed `[string]`, coercing `$false` into the string `'False'`. That string is non-empty, therefore truthy, and the branch you meant to skip runs every time. Use a distinctly named variable:

```powershell
[bool] $shouldGrantLoginManager =
  @('1','true','yes') -contains $GrantLoginManager.Trim().ToLowerInvariant()
```

### Build connection strings, do not concatenate them

Generated passwords contain `=` and `;`, which are the two characters a connection string uses as structure. String concatenation produces a connection string that parses into something else entirely, and the error you get back is a login failure, which sends you looking at permissions. The builder quotes and escapes for you.

```powershell
$b = New-Object System.Data.SqlClient.SqlConnectionStringBuilder
$b['Server']                 = "tcp:$SqlServerFqdn,1433"
$b['Initial Catalog']        = $Database
$b['User ID']                = $Login
$b['Password']               = $Password
$b['Encrypt']                = $true
$b['TrustServerCertificate'] = $false
$b.ConnectionString   # correctly quoted. never log this.
```

## When to reach for something else

Reach for it when all of these hold at once:

- The target is **deliberately unreachable** from the build environment, and that is a control you want to keep rather than an accident you want to fix.
- There is **already a trusted host inside the permitted network**, with a lifecycle somebody else is paying for.
- The operation is **occasional** — a handful of applies per environment per year, not part of every deployment.
- The operation **can be made idempotent**, so that a retry is genuinely harmless.

Take any one of those away and something else is the better answer. This pattern is narrow and I would not want to see it spread.

- **If you need data-plane work on every apply, or against many targets**, the run command's lack of output and awkward failure modes will grind you down. Put an agent in the VNet and accept the standing infrastructure.
- **If there is no VM in the VNet**, the pattern has no host. The equivalent move for a VM-less workload is a container job in a delegated subnet, which gets you the same "execute where the route already is" property with a different execution model.
- **If the operation is not idempotent**, do not retry it, and then think hard before choosing a transport whose failures are as ambiguous as this one's.
- **If you can drop the SQL-authenticated account entirely**, do that instead. Ours exists only because a vendor installer requires it. Every one of these problems disappears with a managed identity.

## The thing worth taking away

When a pipeline is blocked by a network control, the instinct is to give the pipeline a route, and to treat the control as the obstacle. Occasionally that is correct. More often the control is the requirement and the pipeline is simply standing in the wrong place.

Azure gives you two separate ways to reach a machine, and only one of them cares about your network topology. Moving the execution rather than the permission cost us some ergonomics, a retry loop and a log file we have to publish as an artifact. What it did not cost was the network boundary, which is the whole point. What it did cost is a more valuable target in the admin VM, and that is the honest price rather than no price at all.

---

*The code in this article is simplified from a production implementation. Resource names, subscription identifiers and environment specifics have been replaced with placeholders throughout.*

*Corrections and better ideas are welcome. If you have solved this differently, particularly on a workload with no VM to borrow, I would like to hear about it.*
