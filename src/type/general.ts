export type ServiceResponseFailure = {
  success: false;
  statusCode?: number;
  message: any;
  code?: string;
  requestId?: string;
  error?: string | Record<string, unknown>[];
  fieldErrors?: { field: string; code: string; message: string }[];
};

export type ServiceResponse<T> =
  | {
      success: true;
      statusCode?: number;
      data: T;
    }
  | ServiceResponseFailure;
