# AWS deployment guide

This guide maps the repository to AWS in **ap-southeast-2 (Sydney)**. It assumes the admin dashboard is hosted on Amplify, the API runs on EC2, PostgreSQL/PostGIS runs on RDS, and media is private in S3 and delivered through signed CloudFront URLs.

This does not provision AWS resources. Use the AWS Console or your approved infrastructure-as-code workflow, and replace every `example.com`/`your-*` value with your own values.

## What goes where

| Component | AWS service | Repository detail |
|---|---|---|
| Admin dashboard | Amplify Hosting | Vite app in `admin-web/`; build output is `dist/`. |
| HTTP API | EC2 behind an internet-facing Application Load Balancer (ALB) | Express listens on port `5000`; health check is `GET /health`. |
| Application database | RDS for PostgreSQL with PostGIS | `api/sql/complete_globalstation.sql` enables `pgcrypto` and PostGIS. |
| Uploaded posters and videos | Private S3 bucket | The API creates presigned `PUT` URLs; the browser uploads directly to S3. |
| Media delivery | CloudFront with signed URLs and a private S3 origin | API signing URLs expire after five minutes. |
| Mobile app | Apple App Store / Google Play (or internal testing) | This is a native React Native app; Amplify Hosting does not publish the iOS/Android apps. |

Keep the API and RDS in the same VPC and AWS Region. Do not make RDS or the S3 bucket public.

## 1. Prepare the AWS account and domain

1. Enable MFA on the AWS root user, do not use it for everyday work, and create an IAM Identity Center administrator for setup.
2. Select **Asia Pacific (Sydney), `ap-southeast-2`** for regional resources. CloudFront is global.
3. Register or choose a domain. A useful layout is `admin.example.com`, `api.example.com`, and optionally `media.example.com`.
4. Create an AWS Budget and billing alerts before starting. EC2, ALB, RDS Multi-AZ, NAT gateways, storage, and especially video delivery can all incur ongoing charges. Check the [AWS Pricing Calculator](https://calculator.aws/) for your expected traffic and region; do not rely on a free-tier assumption for production.

For production with real users, plan for at least two Availability Zones, an ALB, an EC2 Auto Scaling group with at least two healthy instances, and an RDS Multi-AZ deployment. One EC2 instance or a single-AZ database is cheaper but has an outage risk. Keep media uploads direct to S3 so API instances do not proxy multi-gigabyte files.

## 2. Create the VPC and security boundaries

Use a VPC with public and private subnets in at least two Availability Zones:

- Put the ALB in public subnets.
- Put EC2 instances and RDS in private subnets. Give EC2 outbound access for OS/package updates through a NAT gateway, or deliberately configure the needed VPC endpoints. An S3 gateway endpoint can keep S3 traffic on the AWS network.
- Create separate security groups:
  - **ALB:** inbound TCP 443 from the internet; optionally TCP 80 only to redirect to HTTPS.
  - **EC2 API:** inbound TCP 5000 only from the ALB security group. Do not expose port 5000 or SSH (22) to the internet.
  - **RDS:** inbound TCP 5432 only from the EC2 API security group.
- Use Systems Manager Session Manager and an EC2 instance role for administration instead of opening SSH or installing long-lived AWS access keys.

For a small demo, a simpler network can be used, but still keep the database private and restrict inbound rules to security-group references rather than `0.0.0.0/0`.

## 3. Create RDS PostgreSQL and initialize PostGIS

1. Create an RDS for PostgreSQL DB in `ap-southeast-2`, in the private DB subnet group. Turn **Public access** off, enable encryption, automatic backups, deletion protection, and storage autoscaling. Choose a PostgreSQL engine version that offers the `postgis` extension; verify it in the RDS extension list for the selected version.
2. Use a generated master password and store it in Secrets Manager. Do not put the master password in source control or use the master user as the API's permanent login.
3. Connect to RDS from the VPC (for example via a short-lived EC2/SSM session). Create the `globalstation` database and install the extensions as an RDS privileged user:

   ```sql
   CREATE DATABASE globalstation;
   \connect globalstation
   CREATE EXTENSION IF NOT EXISTS pgcrypto;
   CREATE EXTENSION IF NOT EXISTS postgis;
   SELECT PostGIS_Full_Version();
   ```

   If using the `psql` console, `\connect` is a `psql` command, not SQL. Alternatively, connect directly to the new database before running the extension statements.
4. Create a separate `globalstation_app` login, grant it `CONNECT` to the database and `USAGE, CREATE` on the `public` schema, and use that role for schema migrations and API access. For example, connect to the maintenance database as the RDS privileged user, run `CREATE ROLE globalstation_app LOGIN;`, set its password with `\password globalstation_app`, and grant `CONNECT` on `globalstation`. Then connect to `globalstation` and run `GRANT USAGE, CREATE ON SCHEMA public TO globalstation_app;`. Since the extensions already exist, the application role does not need permanent `rds_superuser` privileges.
5. Download the current AWS RDS CA bundle to the EC2 host and set `NODE_EXTRA_CA_CERTS` to its path. This app configures PostgreSQL TLS certificate verification in production (`rejectUnauthorized: true`); do not disable certificate validation to work around connection errors.
6. Once the API is deployed, run the schema migration once from an instance that can reach the private RDS endpoint. Back up the DB first if it already contains data:

   ```sh
   cd /opt/globalstation/api
   npm ci
   npm run build
   node dist/migrate.js
   ```

   `npm run db:migrate` is the development-script equivalent. The migration applies the full schema and integration migrations; **do not run `npm run db:seed` against production**. For later releases, inspect and back up before applying schema changes.

## 4. Create the private S3 media bucket and CloudFront distribution

1. Create a dedicated general-purpose S3 bucket in `ap-southeast-2`. Keep **Block all public access** enabled, use **Bucket owner enforced** object ownership, enable default encryption and versioning, and do not enable public website hosting.
2. Add an EC2 instance role with `AmazonSSMManagedInstanceCore` for Session Manager and least-privilege S3 access. The API needs `s3:PutObject`, `s3:GetObject` (also authorizes `HeadObject`), and `s3:DeleteObject` on this bucket's object ARNs; it does not need public access or broad S3 permissions. If the API reads secrets directly from Secrets Manager, grant `secretsmanager:GetSecretValue` only for those secret ARNs (and `kms:Decrypt` only if you use a customer-managed KMS key). Do not create access keys for the EC2 host.
3. Create a CloudFront distribution with the S3 REST endpoint as origin, create an **Origin Access Control (OAC)**, choose **Sign requests**, and restrict the bucket policy so only that distribution can read objects. Do not use an S3 website endpoint for this private-media origin.
4. Create a CloudFront public key and key group. Add the key group to the distribution behavior's **trusted key groups** so viewers need signed URLs. Keep the matching private key only in Secrets Manager/Parameter Store for the API. Set `CLOUDFRONT_KEY_PAIR_ID` to the CloudFront public key ID accepted by the key group, and `CLOUDFRONT_DOMAIN` to the distribution hostname (or your media hostname). For a custom CloudFront hostname such as `media.example.com`, add it as an alternate domain name and use an ACM certificate issued in **us-east-1**.
5. Configure S3 CORS for direct browser uploads. Allow only your Amplify dashboard origin(s), method `PUT`, and the request headers `content-type` and `x-amz-meta-expected-size`; expose `ETag` if your client needs it. The API signs these headers, so do not strip them in the browser upload or CORS rule.
6. In the API environment, set `MEDIA_STORAGE_DRIVER=s3`, `AWS_REGION=ap-southeast-2`, `AWS_S3_BUCKET`, `CLOUDFRONT_DOMAIN`, `CLOUDFRONT_KEY_PAIR_ID`, and `CLOUDFRONT_PRIVATE_KEY`.

The current API stores MP4 files and signs CloudFront URLs; it does **not** transcode videos into HLS/DASH or generate adaptive-bitrate renditions. If production streaming needs adaptive playback, plan a separate transcoding pipeline (for example AWS Elemental MediaConvert) and update the app/API to use its output manifests. CloudFront/S3 alone do not transcode.

## 5. Deploy the API on EC2

1. Request an ACM TLS certificate for `api.example.com` in **ap-southeast-2** and validate it in DNS. (The ALB certificate must be in the same Region as the ALB.)
2. Create an ALB in the public subnets, attach the certificate to its HTTPS listener, and forward to an HTTP target group on port `5000`. Redirect HTTP to HTTPS. Configure the target group's health check as `/health` and accept HTTP `200`.
3. Create the EC2 Auto Scaling group in private subnets and attach it to the target group. Install Node.js **22.11 or newer** (the version required by the repository), and create an unprivileged Linux service account for the API. Use the EC2 instance profile for SSM and S3 access.
4. Deploy the `api/` directory, including its `package-lock.json` and `sql/` directory. Use a deployment pipeline (for example GitHub Actions with AWS OIDC, or CodePipeline/CodeDeploy); do not store a GitHub personal access token or AWS access key on the server. For an initial manual deployment, use a temporary, private artifact transfer path and remove the artifact afterward.
5. From `api/`, run `npm ci`, `npm run build`, then `node dist/migrate.js` for the first deployment. Do not run `npm run db:seed`. After building/migrating, `npm prune --omit=dev` can remove development-only dependencies.
6. Supply the production variables through Secrets Manager/Parameter Store and a tightly permissioned service environment file (for example mode `640`, owned by root and the service group). Create a `systemd` unit with working directory `/opt/globalstation/api`, command `node dist/server.js`, automatic restart on failure, and the API's unprivileged service account. For example:

   ```ini
   [Unit]
   Description=Global Station API
   Wants=network-online.target
   After=network-online.target

   [Service]
   Type=simple
   User=globalstation
   Group=globalstation
   WorkingDirectory=/opt/globalstation/api
   EnvironmentFile=/etc/globalstation-api.env
   ExecStart=/usr/bin/node dist/server.js
   Restart=on-failure
   RestartSec=5
   NoNewPrivileges=true
   PrivateTmp=true

   [Install]
   WantedBy=multi-user.target
   ```

   Adjust `ExecStart` if Node is installed at a different path, then run `sudo systemctl daemon-reload` and `sudo systemctl enable --now globalstation-api`. Do not bake secrets into the AMI, deployment archive, or Git repository.
7. Point `api.example.com` to the ALB with a Route 53 alias (or the equivalent record at your DNS provider).
8. For the API environment, set:

   ```dotenv
   NODE_ENV=production
   PORT=5000
   DATABASE_URL=postgresql://globalstation_app:<URL-ENCODED-PASSWORD>@<private-rds-endpoint>:5432/globalstation
   JWT_SECRET=<random-secret-at-least-32-characters>
   CORS_ORIGIN=https://admin.example.com
   TRUST_PROXY=true
   MEDIA_STORAGE_DRIVER=s3
   AWS_REGION=ap-southeast-2
   AWS_S3_BUCKET=<private-media-bucket>
   CLOUDFRONT_DOMAIN=<cloudfront-domain>
   CLOUDFRONT_KEY_PAIR_ID=<cloudfront-public-key-id>
   CLOUDFRONT_PRIVATE_KEY=<private-key-from-secrets-manager>
   PUBLIC_API_URL=https://api.example.com
   ```

   Also set `NODE_EXTRA_CA_CERTS` to the RDS CA bundle path. `CORS_ORIGIN` is a **single origin** in the current API; use the one canonical admin origin (no trailing slash). Mobile clients do not use browser CORS, but must use the HTTPS API URL.

The repo has a local-development variable template at [`api/.env.example`](../api/.env.example). It contains placeholders, not real secrets; do not deploy its development defaults. The API's `DATABASE_URL` is mandatory, and `JWT_SECRET` must be at least 32 characters. `PUBLIC_API_URL` is the API origin only (no `/api/v1`); Stripe callback URLs use it.

## 6. Deploy the admin dashboard with Amplify Hosting

The Amplify build configuration is at the repository root in [`amplify.yml`](../amplify.yml). In Amplify Hosting:

1. Connect the Git repository and select the branch to deploy.
2. Set the monorepo app root environment variable to **`AMPLIFY_MONOREPO_APP_ROOT=admin-web`**. Amplify requires this value to match `appRoot` in `amplify.yml`.
3. The build runs in `admin-web/`:

   ```sh
   npm ci
   npm run build
   ```

   The npm build script runs `tsc -b && vite build`; the deployable artifact directory is **`dist`**.
4. Add the Amplify build environment variable **`VITE_API_URL=https://api.example.com/api/v1`**. Vite embeds `VITE_*` values into the public frontend bundle, so never put credentials or other secrets in them.
5. Connect your chosen dashboard domain (for example `admin.example.com`) and wait for its HTTPS certificate/DNS setup to complete. Set the API's `CORS_ORIGIN` to exactly this origin.
6. Push a small change to the connected branch and verify the Amplify build log, deployed page, and browser network requests. The browser should call the HTTPS API, not `localhost`.

If you use Amplify's generated domain instead of a custom domain, use that exact HTTPS origin for `CORS_ORIGIN` and the S3 CORS `AllowedOrigins`. The current API supports one browser origin at a time; when switching to a custom domain, update those values and redeploy the API.

## 7. Point the mobile app at the production API

Important: [`src/api/client.ts`](../src/api/client.ts) currently constructs a development URL using the Metro host and port `5000`; it has no production API URL setting. A store build will **not** automatically use the Amplify `VITE_API_URL`. Before releasing Android/iOS builds, add a production API base URL and select it for non-development builds, while keeping the current local behavior for `__DEV__`. For example:

```ts
const PRODUCTION_API_BASE_URL = 'https://api.example.com/api/v1';

function getApiBaseUrl(): string {
  if (!__DEV__) return PRODUCTION_API_BASE_URL;
  // Keep the existing Metro-host/local-emulator logic below for development.
  // ...
}
```

Replace the example domain, then build and test each platform. Do not ship a release that calls `localhost`, `10.0.2.2`, or port `5000` over plain HTTP.

## 8. Stripe and production secrets

- Keep `STRIPE_MODE=test` and test keys until the API is reachable over HTTPS and the Stripe account is ready. Store `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `JWT_SECRET`, the DB password, and the CloudFront private key in Secrets Manager/Parameter Store, not Amplify variables or Git.
- For live payments, register Stripe's webhook endpoint as `https://api.example.com/api/v1/payments/stripe/webhook`, configure the signing secret, and only then set `STRIPE_MODE=live` with the live key. Confirm the API has the live HTTPS `PUBLIC_API_URL`.
- Rotate secrets if they were ever committed or shared. Do not use the development seed account or sample users in production.

## 9. Verify, monitor, and maintain

1. Open `https://api.example.com/health`; expect JSON with `"status":"ok"`.
2. Confirm Amplify serves the admin UI over HTTPS and a sign-in request reaches `https://api.example.com/api/v1`.
3. Test an admin poster upload end to end: the browser's S3 `PUT` should succeed, the API should verify/store the object reference, and the CloudFront playback URL should be signed and expire.
4. Confirm EC2 cannot be reached directly from the internet on port 5000; RDS is not public; S3 has no public access; the API has no AWS access keys on disk.
5. Confirm an authorized backup restore procedure for RDS and S3, configure CloudWatch logs/alarms for API health, EC2 CPU/disk, ALB 5xx/target health, RDS storage/connections, and set budget alerts.
6. Use a separate staging environment and database before production migrations. Plan an explicit rollback and database backup before schema releases.

Useful repository commands:

```sh
# Dashboard (run in admin-web/)
npm ci
npm run build

# API (run in api/)
npm ci
npm run build
npm test
```

## AWS references

- [Amplify Hosting monorepo configuration](https://docs.aws.amazon.com/amplify/latest/userguide/monorepo-configuration.html)
- [PostGIS extensions on RDS for PostgreSQL](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Appendix.PostgreSQL.CommonDBATasks.PostGIS.html)
- [Restricting S3 origin access with CloudFront OAC](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html)
- [Amazon RDS SSL/TLS certificates](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.SSL.html)
