import "../lib/env";

import { sql } from "drizzle-orm";
import db, { client } from "../lib/initDB";

type Command = "preflight" | "backfill-sidebar";

type DuplicateCategoryName = {
  normalized_name: string;
  category_ids: string[];
  category_names: string[];
};

type InvalidEmployeeParent = {
  employee_id: string;
  employee_email: string;
  employee_status: string;
  account_group_id: string | null;
  parent_id: string | null;
  parent_email: string | null;
  parent_role: string | null;
  parent_status: string | null;
};

async function preflight() {
  const [summary] = await db.execute<{
    duplicate_category_name_groups: number;
    employees_without_active_seller_parent: number;
  }>(sql`
    select
      (
        select count(*)::int
        from (
          select lower(btrim(name))
          from categories
          group by lower(btrim(name))
          having count(*) > 1
        ) duplicates
      ) as duplicate_category_name_groups,
      (
        select count(*)::int
        from accounts employee
        left join account_groups account_group
          on account_group.id = employee.account_group_id
        left join accounts parent
          on parent.id = account_group.parent_id
        where employee.role = 'employee'
          and employee.status = 'active'
          and (
            parent.id is null
            or parent.role <> 'seller'
            or parent.status <> 'active'
          )
      ) as employees_without_active_seller_parent
  `);
  console.log(summary);

  if (summary.duplicate_category_name_groups > 0) {
    const duplicateCategories = await db.execute<DuplicateCategoryName>(sql`
      select
        lower(btrim(name)) as normalized_name,
        array_agg(id::text order by id) as category_ids,
        array_agg(name order by id) as category_names
      from categories
      group by lower(btrim(name))
      having count(*) > 1
      order by lower(btrim(name))
    `);
    console.error("Case-insensitive duplicate category groups:");
    console.table(duplicateCategories);
  }

  if (summary.employees_without_active_seller_parent > 0) {
    const invalidEmployees = await db.execute<InvalidEmployeeParent>(sql`
      select
        employee.id::text as employee_id,
        employee.email as employee_email,
        employee.status::text as employee_status,
        employee.account_group_id::text as account_group_id,
        parent.id::text as parent_id,
        parent.email as parent_email,
        parent.role::text as parent_role,
        parent.status::text as parent_status
      from accounts employee
      left join account_groups account_group
        on account_group.id = employee.account_group_id
      left join accounts parent
        on parent.id = account_group.parent_id
      where employee.role = 'employee'
        and employee.status = 'active'
        and (
          parent.id is null
          or parent.role <> 'seller'
          or parent.status <> 'active'
        )
      order by employee.email, employee.id
    `);
    console.error("Employees without an active seller parent:");
    console.table(invalidEmployees);
  }

  if (summary.duplicate_category_name_groups > 0) {
    throw new Error(
      "Resolve case-insensitive duplicate category names before migration.",
    );
  }
  if (summary.employees_without_active_seller_parent > 0) {
    throw new Error(
      "Resolve active employee accounts that are not attached to an active seller.",
    );
  }
  console.log("Admin Section 1 preflight passed.");
}

async function backfillSidebar() {
  const configured = process.env.ADMIN_SIDEBAR_CUTOVER_AT;
  const cutoverAt = configured ? new Date(configured) : new Date();
  if (Number.isNaN(cutoverAt.getTime())) {
    throw new Error("ADMIN_SIDEBAR_CUTOVER_AT must be an ISO 8601 date-time.");
  }
  const rows = await db.execute(sql`
    insert into admin_sidebar_read_states (
      account_id,
      scope_key,
      section,
      last_seen_at
    )
    select
      account.id,
      case
        when account.role = 'admin' then 'platform'
        when account.role = 'seller' then account.id::text
        else parent.id::text
      end,
      section.value::admin_sidebar_section,
      ${cutoverAt.toISOString()}::timestamptz
    from accounts account
    left join account_groups account_group
      on account_group.id = account.account_group_id
    left join accounts parent
      on parent.id = account_group.parent_id
    cross join (
      values ('orders'), ('deliveries'), ('refunds'), ('advertisements'), ('chatrooms')
    ) section(value)
    where account.status = 'active'
      and account.deleted_at is null
      and (account.role <> 'employee' or parent.id is not null)
    on conflict (account_id, scope_key, section) do nothing
    returning account_id
  `);
  console.log({ insertedReadStates: rows.length, cutoverAt: cutoverAt.toISOString() });
}

async function main() {
  const command = (process.argv[2] ?? "preflight") as Command;
  if (command === "preflight") await preflight();
  else if (command === "backfill-sidebar") await backfillSidebar();
  else throw new Error(`Unknown command: ${command}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await client.end();
  });
