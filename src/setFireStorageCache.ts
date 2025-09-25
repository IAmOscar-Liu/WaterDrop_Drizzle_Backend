import { bucket } from "./lib/firebase_admin";

// Function to set video cache
const setVideoCache = async (
  advertisementId: string,
  cacheDuration: number = 24 * 60 * 60
) => {
  const file = bucket.file(`advertisements/${advertisementId}.mp4`);
  await file
    .setMetadata({
      cacheControl: `public,max-age=31536000,immutable`,
    })
    .then(() => {
      console.log(
        `Cache control set for advertisement ${advertisementId} to ${cacheDuration} seconds`
      );
    })
    .catch((error) => {
      console.error(
        `Error setting cache control for advertisement ${advertisementId}:`,
        error
      );
    });
};

async function main() {
  const prefix = "advertisements/";

  // With delimiter:'/' we only get *direct* files, not those in subfolders.
  const [files] = await bucket.getFiles({ prefix, delimiter: "/" });

  const advertisementIds = Array.from(
    new Set(
      files
        .map((f) => f.name) // e.g. "advertisements/123.mp4"
        .filter((name) => name.startsWith(prefix))
        .map((name) => name.slice(prefix.length)) // e.g. "123.mp4"
        .filter((base) => base.length > 0 && !base.endsWith("/"))
        .filter((base) => /\.mp4$/i.test(base)) // only .mp4 files
        .map((base) => base.replace(/\.mp4$/i, "")) // "123"
    )
  );

  console.log(advertisementIds);

  if (advertisementIds.length === 0) {
    console.log("No .mp4 files found directly under /advertisements");
    return;
  }

  await Promise.all(advertisementIds.map((id) => setVideoCache(id)));

  console.log(
    `Processed ${advertisementIds.length} advertisement(s):`,
    advertisementIds
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
