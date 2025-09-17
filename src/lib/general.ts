import { Response } from "express";
import { ServiceResponse } from "../type/general";

export function sendJsonResponse<T>(res: Response, result: ServiceResponse<T>) {
  res.status(result.statusCode ?? 200).json(result);
}

export function getRandomInteger(min: number = 0, max: number = 100) {
  min = Math.ceil(min); // Ensure min is an integer
  max = Math.floor(max); // Ensure max is an integer
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
