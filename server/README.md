# LilyPlan Function Compute backend

This is a Node.js 20 Web function for Alibaba Cloud Function Compute.

## Runtime configuration

- Startup command: `npm run start`
- Port: `9000`
- Memory: `512 MB`
- Timeout: `60 seconds`
- Execution role: `LilyPlanFunctionRole`

Copy the non-comment values from `.env.example` into the Function Compute environment-variable editor. Do not add permanent AccessKeys. Function Compute injects temporary role credentials automatically.

## HTTP trigger

Enable Bearer authentication. Store the token only as the encrypted ESA variable `FC_BEARER_TOKEN`. The application additionally requires the `x-lilyplan-proxy: esa` header on business APIs; the ESA proxy adds it automatically.

## Health check

`GET /api/health` verifies configuration, role credentials, connectivity and the presence of all seven tables. A healthy deployment returns:

```json
{"ok":true}
```

If it returns `CONFIGURATION_INCOMPLETE`, review the environment variables and the selected function role. If the function log says a table must contain exactly one primary key, correct that table before storing real data.
