import { Request, Response } from "express";
import path from "path";

class FileController {
  renderUserConsentDocument(_: Request, res: Response) {
    res.sendFile(
      path.resolve(process.cwd(), "src/assets/html/user-consent.html")
    );
  }
}

export default new FileController();
