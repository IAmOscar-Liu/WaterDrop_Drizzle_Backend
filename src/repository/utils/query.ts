import { SQL, and } from "drizzle-orm";

export type PaginationParams = {
  page?: number;
  limit?: number;
};

export function getPagination(page = 1, limit = 10) {
  return {
    page,
    limit,
    offset: (page - 1) * limit,
  };
}

export function getTotalPages(total: number, limit: number) {
  return Math.ceil(total / limit);
}

export function compactConditions(
  conditions: Array<SQL | undefined>,
): SQL | undefined {
  const filteredConditions = conditions.filter(
    (condition): condition is SQL => condition !== undefined,
  );

  return filteredConditions.length > 0 ? and(...filteredConditions) : undefined;
}
