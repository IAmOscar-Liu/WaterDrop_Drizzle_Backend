import { Response } from "express";

import { sendJsonResponse } from "../lib/general";
import accountWalletService from "../services/accountWallet";
import { RequestWithId } from "../type/request";

class AccountWalletController {
  async getOwnWallet(req: RequestWithId, res: Response): Promise<any> {
    sendJsonResponse(
      res,
      await accountWalletService.getWallet(req.userId ?? ""),
    );
  }

  async listOwnTransactions(req: RequestWithId, res: Response): Promise<any> {
    sendJsonResponse(
      res,
      await accountWalletService.listTransactions(
        transactionListInput(req.userId ?? "", req.query),
      ),
    );
  }

  async getOwnSummary(req: RequestWithId, res: Response): Promise<any> {
    sendJsonResponse(
      res,
      await accountWalletService.getSummary(
        summaryInput(req.userId ?? "", req.query),
      ),
    );
  }

  async getAccountSummary(req: RequestWithId, res: Response): Promise<any> {
    sendJsonResponse(
      res,
      await accountWalletService.getSummary(
        summaryInput(req.params.accountId, req.query),
      ),
    );
  }

  async getAccountWallet(req: RequestWithId, res: Response): Promise<any> {
    sendJsonResponse(
      res,
      await accountWalletService.getWallet(req.params.accountId),
    );
  }

  async listAccountTransactions(
    req: RequestWithId,
    res: Response,
  ): Promise<any> {
    sendJsonResponse(
      res,
      await accountWalletService.listTransactions(
        transactionListInput(req.params.accountId, req.query),
      ),
    );
  }

  async creditAccountWallet(req: RequestWithId, res: Response): Promise<any> {
    const { amount, idempotencyKey, reason, externalReference, metadata } =
      req.body;
    sendJsonResponse(
      res,
      await accountWalletService.creditSellerWallet({
        accountId: req.params.accountId,
        actorAccountId: req.userId ?? "",
        amount,
        idempotencyKey,
        reason,
        externalReference,
        metadata,
      }),
    );
  }
}

function transactionListInput(
  accountId: string,
  query: RequestWithId["query"],
) {
  const { page, limit, type, startAt, endAt } = query;
  return {
    accountId,
    page: page === undefined ? undefined : Number(page),
    limit: limit === undefined ? undefined : Number(limit),
    type: type as
      | "legacy_opening_balance"
      | "admin_credit"
      | "advertisement_funding_debit"
      | undefined,
    startAt: startAt === undefined ? undefined : new Date(String(startAt)),
    endAt: endAt === undefined ? undefined : new Date(String(endAt)),
  };
}

function summaryInput(accountId: string, query: RequestWithId["query"]) {
  return {
    accountId,
    startAt: query.startAt === undefined ? undefined : new Date(String(query.startAt)),
    endAt: query.endAt === undefined ? undefined : new Date(String(query.endAt)),
  };
}

export default new AccountWalletController();
