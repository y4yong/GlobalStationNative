This is a new [**React Native**](https://reactnative.dev) project, bootstrapped using [`@react-native-community/cli`](https://github.com/react-native-community/cli).

# Getting Started

> **Note**: Make sure you have completed the [Set Up Your Environment](https://reactnative.dev/docs/set-up-your-environment) guide before proceeding.

## Step 1: Start Metro

First, you will need to run **Metro**, the JavaScript build tool for React Native.

To start the Metro dev server, run the following command from the root of your React Native project:

```sh
# Using npm
npm start

# OR using Yarn
yarn start
```

## Step 2: Build and run your app

With Metro running, open a new terminal window/pane from the root of your React Native project, and use one of the following commands to build and run your Android or iOS app:

### Android

```sh
# Using npm
npm run android

# OR using Yarn
yarn android
```

### iOS

For iOS, remember to install CocoaPods dependencies (this only needs to be run on first clone or after updating native deps).

The first time you create a new project, run the Ruby bundler to install CocoaPods itself:

```sh
bundle install
```

Then, and every time you update your native dependencies, run:

```sh
bundle exec pod install
```

For more information, please visit [CocoaPods Getting Started guide](https://guides.cocoapods.org/using/getting-started.html).

```sh
# Using npm
npm run ios

# OR using Yarn
yarn ios
```

If everything is set up correctly, you should see your new app running in the Android Emulator, iOS Simulator, or your connected device.

This is one way to run your app — you can also build it directly from Android Studio or Xcode.

## Step 3: Modify your app

Now that you have successfully run the app, let's make changes!

Open `App.tsx` in your text editor of choice and make some changes. When you save, your app will automatically update and reflect these changes — this is powered by [Fast Refresh](https://reactnative.dev/docs/fast-refresh).

When you want to forcefully reload, for example to reset the state of your app, you can perform a full reload:

- **Android**: Press the <kbd>R</kbd> key twice or select **"Reload"** from the **Dev Menu**, accessed via <kbd>Ctrl</kbd> + <kbd>M</kbd> (Windows/Linux) or <kbd>Cmd ⌘</kbd> + <kbd>M</kbd> (macOS).
- **iOS**: Press <kbd>R</kbd> in iOS Simulator.

## Congratulations! :tada:

You've successfully run and modified your React Native App. :partying_face:

### Now what?

- If you want to add this new React Native code to an existing application, check out the [Integration guide](https://reactnative.dev/docs/integration-with-existing-apps).
- If you're curious to learn more about React Native, check out the [docs](https://reactnative.dev/docs/getting-started).

# Troubleshooting

If you're having issues getting the above steps to work, see the [Troubleshooting](https://reactnative.dev/docs/troubleshooting) page.

# Global Station API

The mobile app expects the API at `http://10.0.2.2:5000/api/v1` when running in the Android emulator.

From the repository root:

```sh
cd api
npm install
Copy-Item .env.example .env
npm run db:migrate
npm run dev
```

The API uses PostgreSQL with PostGIS for geography and location rules. Install PostGIS on the PostgreSQL server, create the database with `api/sql/00_create_database.sql`, then set `DATABASE_URL` and a JWT secret of at least 32 characters in `api/.env`. `npm run db:migrate` applies the schema portion of `api/sql/complete_globalstation.sql` and does not insert development fixtures. Migrations preserve existing business data; retired payment-provider records are retained as `LEGACY`. `npm run db:migrate:integrations` applies the payment-provider/ad, audience-analytics, engagement/referral, and demo-content cleanup migrations. New checkout uses Stripe. `npm run db:seed` is an explicit development-only operation that adds sample accounts; do not run it for production data.

Media files are stored outside PostgreSQL. The API defaults to `MEDIA_STORAGE_DRIVER=local` outside production and streams uploads into `api/uploads/`, serving them under `/uploads/`; set `PUBLIC_API_URL` to an address reachable by clients such as an emulator when needed. Set `MEDIA_STORAGE_DRIVER=s3` to use direct S3 presigned uploads. Production defaults to S3, and should use an IAM role or other standard AWS SDK credentials plus a private bucket. PostgreSQL stores only media URL references. Local disk storage is for development and is not durable or horizontally shared.

Content submissions include separate vertical and horizontal poster images and support selecting multiple genres. Vertical artwork is used for catalog cards and detail views; horizontal artwork is used for the mobile Home featured banner, which falls back to the vertical image for older content. The Home feed also groups content into Trending Now (most distinct playback sessions in the last 30 days), Original Series (series content), and New Releases (most recently created content).

## External Services

Copy the non-secret variable names from `api/.env.integrations.example` into `api/.env` and replace every placeholder locally. AWS uses the standard SDK credential chain or an attached IAM role; scope its permissions to the private media bucket. Configure a private S3 bucket, a CloudFront distribution restricted to that bucket, and a trusted key group whose private key is held only by the API. Uploads accept MP4, but the API does not transcode it into HLS/DASH or produce segments; production streaming should connect an asynchronous transcoding pipeline and store the resulting manifest URL in the episode record. CloudFront playback URLs expire after five minutes.

VIP checkout uses Stripe Checkout in test mode by default and offers cards and FPX. Set `STRIPE_SECRET_KEY` to a Stripe test secret key and `STRIPE_WEBHOOK_SECRET` to the webhook signing secret. For local development, run `stripe listen --forward-to localhost:5000/api/v1/payments/stripe/webhook` and use the printed webhook secret; hosted Stripe webhooks require a public HTTPS endpoint. Set `PUBLIC_API_URL` to an API URL reachable by the client for Checkout success and cancel redirects. The authenticated `POST /api/v1/subscriptions/checkout` endpoint creates the hosted session; only signed, amount-verified Stripe webhooks grant VIP access. E-wallets are not enabled yet, but use the same hosted Checkout integration when added. Production requires a registered and approved Stripe merchant account, live keys, and `STRIPE_MODE=live`. Automatic recurring billing is not configured.

Advertisers can submit HTTPS creatives and budgets. New campaigns target free members because VIP membership is ad-free; VIP members never receive ads, including campaigns targeted at all ad-supported viewers. New campaigns remain pending review and cannot reach viewers until an administrator approves and activates them. Support tickets are stored for the customer and can be managed from the admin console. Provider-dependent routes return an explicit configuration error until their account settings are complete; no fake payment, media, ad, or ticket success is generated.

## Audience Analytics

The admin console's Audience analytics view reports daily/monthly active authenticated viewers, 30-day unique viewers and watch time, playback-session duration, programme completion and last observed drop-off position, new-account-to-premium conversion, recorded subscription cancellations/term expiries and failed-checkout counts, subscription/ad revenue estimates, ARPU, revenue per active viewer, device, country, and ad impression/completion/click-through metrics. The admin-only `GET /api/v1/admin/analytics` endpoint serves the data; DAU/MAU and daily trends are based on playback heartbeats, not app opens. Session duration is accumulated watch time, not elapsed time while paused. Conversion is accounts created and converted to premium within the same rolling 30-day cohort. ARPU is successful MYR subscription revenue per paying account over 30 days; ad revenue is estimated from delivered impression CPM and is not a finance ledger. As subscription plans currently use one-time checkout rather than automatic recurring billing, term expiry and failed/abandoned checkouts are reported separately, not treated as recurring-card cancellations. Current cancellation records are generated by administrative membership revocation; self-service cancellation and recurring-payment stop events are not available until those flows are implemented.

Playback and ad tracking stores authenticated account IDs, device family, playback/ad positions, durations, and event times. Country is coarse and optional: only set `TRUST_PROXY=true` when the API is behind a trusted reverse proxy that supplies `CF-IPCountry` or `X-Vercel-IP-Country`; otherwise geography is reported as Unknown. No precise viewer coordinates are collected for analytics.

## Engagement and Referrals

Migration 010 adds an in-app notification inbox, channel preferences, audience-targeted notification campaigns, campaign/referral/influencer/promotion code records, signup attribution, and a reward ledger. Authenticated users can read/mark notifications, manage channel preferences, get a personal short referral code (for example `GS-ABC123`), and see referral attribution and reward status. Registration accepts an optional `referralCode`; attribution is recorded at signup, with self-referrals, expired/inactive codes, and exhausted redemption limits rejected. Previously issued longer referral codes remain valid. Admins can create and send `IN_APP` campaigns to all, free, or VIP accounts; `{{name}}` is replaced with each recipient's name. Other channels can be saved as campaign drafts, but sending returns an explicit not-configured error until a delivery provider is integrated. `scheduledAt` is stored for future scheduling, but no scheduler currently dispatches campaigns automatically.

Referral and promotion rewards are configuration and ledger records only: codes do not yet discount Stripe checkouts or grant subscription time/credit automatically. Qualification rules, reward amounts, approval, and fulfillment must be implemented before offering incentives. Push-token registration/delivery, email delivery, SMS, WhatsApp, campaign analytics, and notification UI are future integrations; channel preferences default to opt-in only for in-app messages. No third-party messaging provider is required or contacted by this foundation.

The mobile viewer flow supports account registration and sign-in through the API. Every new account starts as a Basic user (Viewer); Creator and Advertiser roles can be added from the profile after reviewing and confirming the change. The current API does not include a first-administrator provisioning command; create an administrator through a separately secured operational process before using the admin console on a fresh database.

## Admin Web

The operational admin console lives in `admin-web` and uses the same API. With the API running:

```sh
cd admin-web
npm install
npm run dev
```

Open `http://localhost:5173` and sign in with an administrator account provisioned in the database. The console supports content approval/rejection, payout decisions, campaign approval/rejection and pause/resume, user review, platform metrics, watch telemetry, and audited admin actions.

# Learn More

To learn more about React Native, take a look at the following resources:

- [React Native Website](https://reactnative.dev) - learn more about React Native.
- [Getting Started](https://reactnative.dev/docs/environment-setup) - an **overview** of React Native and how setup your environment.
- [Learn the Basics](https://reactnative.dev/docs/getting-started) - a **guided tour** of the React Native **basics**.
- [Blog](https://reactnative.dev/blog) - read the latest official React Native **Blog** posts.
- [`@facebook/react-native`](https://github.com/facebook/react-native) - the Open Source; GitHub **repository** for React Native.
