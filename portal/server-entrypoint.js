// Kubernetes always sets HOSTNAME to the pod name for every container.
// Next.js's standalone server.js reads it once, synchronously, at the top
// of the file, purely to decide what address to bind to - after that it's
// just another leftover env var. Something deeper in Next.js/Auth.js's
// request-handling internals also reads process.env.HOSTNAME as a fallback
// when constructing absolute redirect URLs (observed: a successful login
// redirected to http://0.0.0.0:3000 instead of the real host), which is
// never what we want since every subdomain here is a different real Host
// header (trustHost: true) - deleting it after server.js has already used
// it for binding lets everything downstream fall back to the actual
// request's Host correctly.
delete process.env.HOSTNAME;
require("./server.js");
