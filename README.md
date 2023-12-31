# Node.js Tesla API

This is a working draft code to interact with Tesla
[Fleet API](https://developer.tesla.com/docs/fleet-api) and
[Vehicle Command API]((https://github.com/teslamotors/vehicle-command))
using signed protobuf messages.

This is a very stripped down version ported from
[original Go code](https://github.com/teslamotors/vehicle-command), with
the purpose of understanding the basics of protobuf message signing.

## Usage

The following code assumes that you have already the OAuth tokens and the public
and private key pair.

It will read the `access_token` and `refresh_token` from a json file, and the key
pair from a .pem file.

```js
import fs from 'fs';
import eckey from 'eckey-utils';
import { FleetApi } from './src/FleetApi.js';
import { CarServer } from './src/CarServer.js';

// Load OAuth tokens
const cfg = JSON.parse(fs.readFileSync('oauth.json'));

// Load private and public keys
const key = eckey.parsePem(fs.readFileSync('private_key.pem', 'utf8').trim());

// Fleet api config
const fleetApi = new FleetApi(cfg.client_id, cfg.access_token, cfg.refresh_token);

// CarServer initialization
const cmdApi = new CarServer(fleetApi, cfg.vin, key);

await cmdApi.startSession();
await cmdApi.chargingSetLimit(80);
```

The code is composed by three classes:

- **FleetApi**, which will forward the commands to Tesla API server.
- **CarServer**, which implements the protobuf protocol.
- **Signer**, which is an internal class used by CarServer to sign the messages.

## Requirements

You need to obtain both an OAuth token for Fleet Api, and a private key to
send commands. For more details, refer to
[Tesla Fleet Api docs](https://developer.tesla.com/docs/fleet-api#overview).

### Obtaining OAuth tokens

To abtain the authentication tokens, you need to register a third-party account
at https://developer.tesla.com. Currently, you must be a bussines entity
to complete the registration.

Once registered, you must submit your app details and will obtain the client-id
and client-secret codes, which will be used to generate the OAuth third-party tokens.

Here is the procedure:

1. Set-up one or more "Allowed Redirect URI(s)" in the app configuration.
   Like for example: https://your_domain/redirect_path
2. Point your browser to the following address:

   ```text
   https://auth.tesla.com/oauth2/v3/authorize?&client_id=$CLIENT_ID&locale=it-IT&prompt=login&redirect_uri=$REDIRECT_URI&response_type=code&scope=$SCOPE&state=$STATE`
   ```

   Where:
   - CLIENT_ID = your_app_client_id
   - REDIRECT_URI = https://your_domain/redirect_path
   - SCOPE = openid%20vehicle_device_data%20offline_access
   - STATE = 7baf90cda7baf90cda7baf90cda (random string)

   For the full list of authorization scopes see
   [here](https://developer.tesla.com/docs/fleet-api#authorization-scopes).
3. You will be prompted to authenticate with a Tesla client account, on behalf of which the
   commands will be sent (it can be different from the developer account), and you must
   authorize the app to use the Fleet API.
4. The browser will then redirect to the forementioned URI, passing the following parameters
   via GET method:

   ```json
   (
       "locale": "it-IT"
       "code": "EU_ab012dfegh...."
       "state": "ZjQwZDE1YjRjOWJi"
       "issuer": "https://auth.tesla.com/oauth2/v3"
   )
   ```

5. Using the "code" value, you can generete the OAuth tokens making the following POST request:

   ```curl
   # Authorization code token request
   CODE=<extract from callback>
   curl --request POST \
   --header 'Content-Type: application/x-www-form-urlencoded' \
   --data-urlencode 'grant_type=authorization_code' \
   --data-urlencode "client_id=$CLIENT_ID" \
   --data-urlencode "client_secret=$CLIENT_SECRET" \
   --data-urlencode "code=$CODE" \
   --data-urlencode "audience=$AUDIENCE" \
   --data-urlencode "redirect_uri=$CALLBACK" \
   'https://auth.tesla.com/oauth2/v3/token'
   # Extract access_token and refresh_token from this response
   ```

6. The access_token will expire after 8 hours, and to obtain new tokens you must make the
   following POST call:

   ```curl
   # Refresh token request
   REFRESH_TOKEN=the_last_valid_refresh_token
   curl --request POST \
   --header 'Content-Type: application/x-www-form-urlencoded' \
   --data-urlencode 'grant_type=refresh_token' \
   --data-urlencode "client_id=$CLIENT_ID" \
   --data-urlencode "refresh_token=$REFRESH_TOKEN" \
   'https://auth.tesla.com/oauth2/v3/token'
   ```

More info here: https://developer.tesla.com/docs/fleet-api#authentication.

### Obtaining private and public key pair

You can generate the keys using the Tesla command line interface available at
https://github.com/teslamotors/vehicle-command.

Download the Go code and build it. You will get some executable commands in the bin folder.

Run the `tesla-keygen` command to generate a key pair and save it to disk, like the
following example:

```bash
tesla-keygen -key-file ~/tesla_private.key -keyring-type file create
```

This will save the key pair in PEM format in a file in your home folder.
