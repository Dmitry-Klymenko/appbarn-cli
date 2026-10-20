---
name: appbarn-install
description: Explain AppBarn Share Links, iOS IPA and Android APK installation rules, and AAB download-only limits. Use for sharing or installing an existing AppBarn build.
---

# Install and share AppBarn builds

Read the [sharing and installation guide](https://docs.app-barn.com/guides/share-install) before advising a user. AppBarn stores binaries; operating systems decide whether an artifact can be installed.

## Choose the right path

- **Android APK:** Download from an authorized Build or existing approved Share Link. Android device settings and package signing still determine whether installation works.
- **Android AAB:** Not directly installable on a phone. Download/store it; use the normal Android distribution tooling to prepare installable packages.
- **iOS IPA:** Only eligible, correctly signed/provisioned IPAs can use supported over-the-air installation. Device registration, certificate/profile expiry, and platform policy still apply.

## Actions an agent can take now

1. Given an authorized Build ID, use `appbarn builds download <build-uuid> --output <local-path>` only with the developer's approval for local file writes.
2. Explain how an authorized human uses the AppBarn Build page to create a time-limited, revocable Share Link or device install ticket. A public Share Link is one-build access; its recipient need not sign in.
3. The current CLI cannot create Share Links or return a tester install URL. Do not invent `appbarn share`, agent approval flows or MCP tools.
4. If a user wants a link, ask them to create it in the AppBarn authenticated UI, then give safe installation guidance. Do not request the private link for analysis if it is unnecessary.
5. Verify the exact platform and whether the human/device reports actual installation. A successful download or link creation is not proof of installation.

## Rules

- Only human managers may create or revoke Share Links under the current authorization model. No agent may bypass that rule.
- Share Links are time-limited (currently seven days), revocable for future access and must not be placed in source control or logs.
- Never expose signing passwords, keys, provisioning profiles or private artifacts to a coding assistant.
- Report unsupported and unknown installability clearly; never promise that an IPA or APK will install.

**Result:** State install eligibility separately from confirmed device installation. For unsupported agent sharing, give the human UI steps.
