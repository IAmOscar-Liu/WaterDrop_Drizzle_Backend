import { Request, Response } from "express";
import path from "path";
import fileService from "../services/file";
import { sendJsonResponse } from "../lib/general";

class FileController {
  renderUserConsentDocument(_: Request, res: Response) {
    res.sendFile(
      path.resolve(process.cwd(), "src/assets/html/user-consent.html")
    );
  }

  async uploadImage(req: Request, res: Response) {
    const file = req.file;
    const { path } = req.body;
    if (!file) {
      return sendJsonResponse(res, {
        success: false,
        statusCode: 400,
        message: "No file provided",
      });
    }

    if (!file.mimetype.startsWith("image/")) {
      return sendJsonResponse(res, {
        success: false,
        statusCode: 400,
        message: "Invalid file type. Only images are allowed.",
      });
    }

    const result = await fileService.uploadFile(
      file,
      path ? `images/${path}` : "images"
    );
    sendJsonResponse(res, result);
  }

  async uploadVideo(req: Request, res: Response) {
    const file = req.file;
    const { path } = req.body;
    if (!file) {
      return sendJsonResponse(res, {
        success: false,
        statusCode: 400,
        message: "No file provided",
      });
    }

    if (!file.mimetype.startsWith("video/")) {
      return sendJsonResponse(res, {
        success: false,
        statusCode: 400,
        message: "Invalid file type. Only videos are allowed.",
      });
    }
    const result = await fileService.uploadFile(
      file,
      path ? `videos/${path}` : "videos"
    );
    sendJsonResponse(res, result);
  }
}

export default new FileController();
