# ESA API proxy

Paste `index.js` into the ESA edge function named `lily-api-proxy`.

Variables are configured separately for test and production. The function reads
them from ESA's `alibaba:workers` runtime module:

- `FC_ORIGIN_URL`: Function Compute HTTP trigger URL.
- `FC_BEARER_TOKEN`: encrypted Bearer token of the Function Compute trigger.

Route only `lilyplan.vip/api/*` to this function.
