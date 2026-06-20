import { Response } from "express";
import { IResponseData } from "../types/responseType.js";

export const sendResponse = (
    res: Response,
    responseData: IResponseData<unknown>,
) => {
    const { httpStatusCode, success, message, data } = responseData;
    res.status(httpStatusCode).json({
        success,
        message,
        data,
    });
};