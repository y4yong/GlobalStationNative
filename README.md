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

The mobile app expects the API on port `5000`. In development it uses the host from the Metro bundle URL, which supports an Android emulator, iOS simulator, or a device on the same network. Android emulator builds fall back to `10.0.2.2`; iOS simulator builds fall back to `localhost`. Keep the API and Metro running, and ensure a physical device and the computer running the API/Metro are on the same network. For an Android phone connected by USB, forward both development ports with `adb reverse tcp:8081 tcp:8081` and `adb reverse tcp:5000 tcp:5000`.

From the repository root:

```sh
cd api
npm install
Copy-Item .env.example .env
npm run db:migrate
npm run dev
```

The API uses PostgreSQL with PostGIS for geography and location rules. Install PostGIS on the PostgreSQL server, create the database with `api/sql/00_create_database.sql`, then set `DATABASE_URL` and a JWT secret of at least 32 characters in `api/.env`. `npm run db:migrate` applies the schema portion of `api/sql/complete_globalstation.sql` and does not insert development fixtures. Existing rows are left untouched. `npm run db:migrate:integrations` applies only the Billplz/ad schema changes. `npm run db:seed` is an explicit development-only operation that adds sample accounts and content; do not run it for production data.

Media files are stored outside PostgreSQL. The API defaults to `MEDIA_STORAGE_DRIVER=local` outside production and streams uploads into `api/uploads/`, serving them under `/uploads/`; set `PUBLIC_API_URL` to an address reachable by clients such as an emulator when needed. Set `MEDIA_STORAGE_DRIVER=s3` to use direct S3 presigned uploads. Production defaults to S3, and should use an IAM role or other standard AWS SDK credentials plus a private bucket. PostgreSQL stores only media URL references. Local disk storage is for development and is not durable or horizontally shared.

## External Services

Copy the non-secret variable names from `api/.env.integrations.example` into `api/.env` and replace every placeholder locally. AWS uses the standard SDK credential chain or an attached IAM role; scope its permissions to the private media bucket. Configure a private S3 bucket, a CloudFront distribution restricted to that bucket, and a trusted key group whose private key is held only by the API. Uploads accept MP4, but the API does not transcode it into HLS/DASH or produce segments; production streaming should connect an asynchronous transcoding pipeline and store the resulting manifest URL in the episode record. CloudFront playback URLs expire after five minutes.

Billplz starts in sandbox mode. Configure its sandbox API key, collection ID, X Signature key, and an HTTPS `PUBLIC_API_URL` that Billplz can reach for callbacks. `localhost` is not reachable from Billplz; use a deployed HTTPS API or a secure development tunnel. VIP checkout uses server-configured MYR amounts and grants a fixed monthly/yearly term after a signature- and amount-verified callback; automatic recurring billing is not configured.

Advertisers can submit HTTPS creatives and budgets. New campaigns start paused for administrator activation. Support tickets are stored for the customer and can be managed from the admin console. Provider-dependent routes return an explicit configuration error until their account settings are complete; no fake payment, media, ad, or ticket success is generated.

The mobile viewer flow supports account registration and sign-in through the API. The current API does not include a first-administrator provisioning command; create an administrator through a separately secured operational process before using the admin console on a fresh database.

## Admin Web

The operational admin console lives in `admin-web` and uses the same API. With the API running:

```sh
cd admin-web
npm install
npm run dev
```

Open `http://localhost:5173` and sign in with an administrator account provisioned in the database. The console supports content approval/rejection, payout decisions, campaign pause/resume, user review, platform metrics, watch telemetry, and audited admin actions.

# Learn More

To learn more about React Native, take a look at the following resources:

- [React Native Website](https://reactnative.dev) - learn more about React Native.
- [Getting Started](https://reactnative.dev/docs/environment-setup) - an **overview** of React Native and how setup your environment.
- [Learn the Basics](https://reactnative.dev/docs/getting-started) - a **guided tour** of the React Native **basics**.
- [Blog](https://reactnative.dev/blog) - read the latest official React Native **Blog** posts.
- [`@facebook/react-native`](https://github.com/facebook/react-native) - the Open Source; GitHub **repository** for React Native.
