import { v4 as uuidv4 } from "uuid";
import { uploadFile } from "../lib/cloudflare";
import { handleServiceError } from "../lib/error";
import { ServiceResponse } from "../type/general";
import fs from "fs/promises";
import path from "path";

class Fileservice {
  async uploadFile(
    file: Express.Multer.File | undefined,
    directory?: string
  ): Promise<ServiceResponse<string>> {
    if (!file) {
      return {
        success: false,
        statusCode: 400,
        message: "No file provided",
      };
    }

    // Use the original file extension for the key in Cloudflare
    const fileExtension = path.extname(file.originalname);
    let key = `${uuidv4()}${fileExtension}`;
    if (directory) {
      // Remove leading/trailing slashes to prevent empty path segments
      const cleanDirectory = directory.replace(/^\/|\/$/g, "");
      key = `${cleanDirectory}/${key}`;
    }
    const localPath = file.path;

    try {
      const fileUrl = await uploadFile({ localPath, key });

      return {
        success: true,
        data: fileUrl,
      };
    } catch (error) {
      return handleServiceError(error);
    } finally {
      // Clean up the locally saved file after upload succeeds or fails
      try {
        await fs.unlink(localPath);
        console.log(`Successfully deleted temporary file: ${localPath}`);
      } catch (cleanupError) {
        console.error(
          `Error deleting temporary file ${localPath}:`,
          cleanupError
        );
      }
    }
  }
}

export default new Fileservice();
