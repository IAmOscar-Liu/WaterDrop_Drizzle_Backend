import path from "path";
import { isLocalOrDevelopment } from "./env";

const assets = {
  consent: { directory: "html", filename: "user-consent.html" },
  support: { directory: "json", filename: "customer-support-content.json" },
} as const;

export function getUserContentAssetPath(kind: keyof typeof assets) {
  const asset = assets[kind];
  return path.resolve(
    process.cwd(),
    "src/assets",
    asset.directory,
    isLocalOrDevelopment() ? "local-development" : ".",
    asset.filename,
  );
}
