import type { ConfigContext, ExpoConfig } from "expo/config";

/**
 * Layered on top of app.json. Everything static lives in app.json; this file
 * only injects values that differ per build environment, so the same source
 * tree can produce development / preview / production builds (see eas.json).
 *
 * EAS_PROJECT_ID is set by `eas init` (it writes extra.eas.projectId into
 * app.json for you); we read it from the environment as well so CI can build
 * without the id being committed.
 */
export default ({ config }: ConfigContext): ExpoConfig => {
  const easProjectId =
    process.env.EAS_PROJECT_ID ?? config.extra?.eas?.projectId ?? undefined;

  const variant = process.env.APP_VARIANT ?? "production";
  const isProduction = variant === "production";

  return {
    ...config,
    name: isProduction ? "AoM Sports Club" : `AoM Sports Club (${variant})`,
    slug: config.slug ?? "aom-sports-club",
    ios: {
      ...config.ios,
      bundleIdentifier: isProduction
        ? "uk.co.aomsportsclub.club"
        : `uk.co.aomsportsclub.club.${variant}`,
    },
    android: {
      ...config.android,
      package: isProduction
        ? "uk.co.aomsportsclub.club"
        : `uk.co.aomsportsclub.club.${variant}`,
    },
    extra: {
      ...config.extra,
      eas: easProjectId ? { projectId: easProjectId } : config.extra?.eas,
    },
    updates: easProjectId
      ? { url: `https://u.expo.dev/${easProjectId}` }
      : config.updates,
    runtimeVersion: { policy: "appVersion" },
  };
};
