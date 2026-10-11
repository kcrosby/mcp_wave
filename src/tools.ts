import { z, type ZodRawShape } from "zod";
import type { Config } from "./config.js";

export type Kind = "read" | "write" | "destructive";

export interface ToolSpec {
  name: string;
  kind: Kind;
  description: string;
  shape: ZodRawShape;
  /** Where the business id comes from, for allowlist enforcement. */
  scope: "args" | "input" | "none";
  build: (args: Record<string, any>, config: Config) => { query: string; variables: Record<string, unknown> };
}

const PAGE = "pageInfo{currentPage totalPages totalCount}";
const ERRS = "didSucceed inputErrors{code message path}";
const money = (f: string) => `${f}{value currency{code}}`;

const businessId = z.string().describe("Wave business id");
const paging = {
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).default(50),
};

function list(name: string, description: string, field: string, node: string, extra: ZodRawShape = {}, extraArgs = ""): ToolSpec {
  return {
    name, kind: "read", description, scope: "args",
    shape: { businessId, ...paging, ...extra },
    build: (a, c) => {
      const filters = Object.keys(extra).map((k) => `${k}:$${k}`).join(",");
      const decl = Object.keys(extra).map((k) => `$${k}:${(extra as any)[k]._wave ?? "String"}`).join(",");
      return {
        query: `query($businessId:ID!,$page:Int!,$pageSize:Int!${decl ? "," + decl : ""}){business(id:$businessId){${field}(page:$page,pageSize:$pageSize${filters ? "," + filters : ""}${extraArgs}){${PAGE} edges{node{${node}}}}}}`,
        variables: { ...a, pageSize: Math.min(a.pageSize, c.maxPageSize) },
      };
    },
  };
}

function get(name: string, description: string, field: string, node: string, idName: string): ToolSpec {
  return {
    name, kind: "read", description, scope: "args",
    shape: { businessId, [idName]: z.string() },
    build: (a) => ({
      query: `query($businessId:ID!,$id:ID!){business(id:$businessId){${field}(id:$id){${node}}}}`,
      variables: { businessId: a.businessId, id: a[idName] },
    }),
  };
}

function mutation(name: string, kind: Kind, description: string, field: string, inputType: string, selection: string, scope: "input" | "none"): ToolSpec {
  return {
    name, kind, description, scope,
    shape: { input: z.record(z.any()).describe(`Wave ${inputType} object`) },
    build: (a) => ({
      query: `mutation($input:${inputType}!){${field}(input:$input){${ERRS} ${selection}}}`,
      variables: { input: a.input },
    }),
  };
}

const CUSTOMER = "id name firstName lastName email phone mobile website currency{code} isArchived";
const PRODUCT = `id name description unitPrice isSold isBought isArchived defaultSalesTaxes{id name}`;
const INVOICE = `id status title invoiceNumber invoiceDate dueDate ${money("total")} ${money("amountDue")} ${money("amountPaid")} customer{id name} viewUrl pdfUrl`;
const ACCOUNT = "id name description displayId type{name value} subtype{name value} normalBalanceType isArchived";

export const TOOLS: ToolSpec[] = [
  { name: "wave_get_user", kind: "read", description: "Get the authenticated Wave user.", scope: "none", shape: {},
    build: () => ({ query: "query{user{id firstName lastName defaultEmail createdAt}}", variables: {} }) },
  { name: "wave_list_businesses", kind: "read", description: "List businesses the token can access.", scope: "none", shape: { ...paging },
    build: (a, c) => ({ query: `query($page:Int!,$pageSize:Int!){businesses(page:$page,pageSize:$pageSize){${PAGE} edges{node{id name isPersonal currency{code} timezone}}}}`,
      variables: { page: a.page, pageSize: Math.min(a.pageSize, c.maxPageSize) } }) },
  { name: "wave_get_business", kind: "read", description: "Get one business.", scope: "args", shape: { businessId },
    build: (a) => ({ query: "query($id:ID!){business(id:$id){id name isPersonal currency{code} timezone address{addressLine1 addressLine2 city postalCode}}}", variables: { id: a.businessId } }) },
  { name: "wave_list_currencies", kind: "read", description: "List supported currencies.", scope: "none", shape: {},
    build: () => ({ query: "query{currencies{code name symbol}}", variables: {} }) },

  list("wave_list_accounts", "List chart of accounts for a business.", "accounts", ACCOUNT),
  list("wave_list_customers", "List customers.", "customers", CUSTOMER),
  list("wave_list_vendors", "List vendors.", "vendors", "id name email phone isArchived"),
  list("wave_list_products", "List products and services.", "products", PRODUCT),
  list("wave_list_sales_taxes", "List sales taxes.", "salesTaxes", "id name abbreviation description rate isCompound isRecoverable isArchived"),
  list("wave_list_invoices", "List invoices, optionally filtered by customer or status.", "invoices", INVOICE,
    { customerId: Object.assign(z.string().optional(), { _wave: "ID" }), status: Object.assign(z.string().optional(), { _wave: "InvoiceStatus" }) }),
  get("wave_get_customer", "Get one customer.", "customer", CUSTOMER, "customerId"),
  get("wave_get_invoice", "Get one invoice with line items.", "invoice", `${INVOICE} items{description quantity unitPrice ${money("subtotal")} product{id name}}`, "invoiceId"),
  get("wave_get_product", "Get one product.", "product", PRODUCT, "productId"),
  get("wave_get_account", "Get one account.", "account", ACCOUNT, "accountId"),

  mutation("wave_customer_create", "write", "Create a customer. input needs businessId and name.", "customerCreate", "CustomerCreateInput", "customer{id name email}", "input"),
  mutation("wave_customer_patch", "write", "Update a customer. input needs id.", "customerPatch", "CustomerPatchInput", "customer{id name email}", "none"),
  mutation("wave_product_create", "write", "Create a product. input needs businessId and name.", "productCreate", "ProductCreateInput", "product{id name}", "input"),
  mutation("wave_product_patch", "write", "Update a product. input needs id.", "productPatch", "ProductPatchInput", "product{id name}", "none"),
  mutation("wave_account_create", "write", "Create an account. input needs businessId, name, subtype.", "accountCreate", "AccountCreateInput", "account{id name}", "input"),
  mutation("wave_account_patch", "write", "Update an account. input needs id.", "accountPatch", "AccountPatchInput", "account{id name}", "none"),
  mutation("wave_sales_tax_create", "write", "Create a sales tax. input needs businessId, name, abbreviation, rate.", "salesTaxCreate", "SalesTaxCreateInput", "salesTax{id name}", "input"),
  mutation("wave_sales_tax_patch", "write", "Update a sales tax. input needs id.", "salesTaxPatch", "SalesTaxPatchInput", "salesTax{id name}", "none"),
  mutation("wave_invoice_create", "write", "Create a draft invoice. input needs businessId, customerId, items.", "invoiceCreate", "InvoiceCreateInput", `invoice{${INVOICE}}`, "input"),
  mutation("wave_invoice_clone", "write", "Clone an invoice. input needs invoiceId.", "invoiceClone", "InvoiceCloneInput", `invoice{${INVOICE}}`, "none"),
  mutation("wave_invoice_approve", "write", "Approve a draft invoice. input needs invoiceId.", "invoiceApprove", "InvoiceApproveInput", "invoice{id status}", "none"),
  mutation("wave_invoice_mark_sent", "write", "Mark an invoice as sent without emailing. input needs invoiceId, sentAt, sendMethod.", "invoiceMarkSent", "InvoiceMarkSentInput", "invoice{id status}", "none"),
  mutation("wave_money_transaction_create", "write", "Create a money transaction. input needs businessId, externalId, date, description, anchor, lineItems.", "moneyTransactionCreate", "MoneyTransactionCreateInput", "transaction{id}", "input"),

  mutation("wave_invoice_send", "destructive", "Email an invoice to the customer (outward-facing). input needs invoiceId, to.", "invoiceSend", "InvoiceSendInput", "", "none"),
  mutation("wave_invoice_delete", "destructive", "Delete an invoice. input needs invoiceId.", "invoiceDelete", "InvoiceDeleteInput", "", "none"),
  mutation("wave_customer_delete", "destructive", "Delete a customer. input needs id.", "customerDelete", "CustomerDeleteInput", "", "none"),
  mutation("wave_product_archive", "destructive", "Archive a product. input needs id.", "productArchive", "ProductArchiveInput", "", "none"),
  mutation("wave_account_archive", "destructive", "Archive an account. input needs id.", "accountArchive", "AccountArchiveInput", "", "none"),
  mutation("wave_sales_tax_archive", "destructive", "Archive a sales tax. input needs id.", "salesTaxArchive", "SalesTaxArchiveInput", "", "none"),
];

const RANK: Record<Kind, number> = { read: 0, write: 1, destructive: 2 };
const MODE_MAX = { readonly: 0, readwrite: 1, full: 2 } as const;

export function isEnabled(spec: ToolSpec, config: Config): boolean {
  const override = config.tools[spec.name];
  if (override) return override === "allow" && businessScopeOk(spec, config);
  return RANK[spec.kind] <= MODE_MAX[config.mode] && businessScopeOk(spec, config);
}

/** With a business allowlist, tools that cannot be tied to a business id are unavailable. */
function businessScopeOk(spec: ToolSpec, config: Config): boolean {
  if (config.businessIds.length === 0) return true;
  return spec.scope !== "none" || spec.name === "wave_get_user" || spec.name === "wave_list_currencies" || spec.name === "wave_list_businesses";
}

export function checkBusiness(spec: ToolSpec, args: Record<string, any>, config: Config): void {
  if (config.businessIds.length === 0 || spec.scope === "none") return;
  const id = spec.scope === "args" ? args.businessId : args.input?.businessId;
  if (!id || !config.businessIds.includes(id)) {
    throw new Error(`Business ${id ?? "(missing)"} is not permitted by the config businessIds allowlist`);
  }
}

/**
 * Decide whether a GraphQL document contains a mutation or subscription.
 * Walks the document with a small lexer so comments and strings are skipped in the order
 * GraphQL reads them. Fails closed: an unterminated string counts as a write.
 */
export function hasWriteOperation(doc: string): boolean {
  let i = 0;
  while (i < doc.length) {
    const ch = doc[i];
    if (ch === "#") {
      while (i < doc.length && doc[i] !== "\n" && doc[i] !== "\r") i++;
    } else if (doc.startsWith('"""', i)) {
      i += 3;
      while (i < doc.length && !doc.startsWith('"""', i)) i += doc.startsWith('\\"""', i) ? 4 : 1;
      if (i >= doc.length) return true;
      i += 3;
    } else if (ch === '"') {
      i++;
      while (i < doc.length && doc[i] !== '"') {
        if (doc[i] === "\n" || doc[i] === "\r") return true;
        i += doc[i] === "\\" ? 2 : 1;
      }
      if (i >= doc.length) return true;
      i++;
    } else if (/[_A-Za-z]/.test(ch)) {
      const start = i;
      while (i < doc.length && /[_0-9A-Za-z]/.test(doc[i])) i++;
      const name = doc.slice(start, i);
      if (name === "mutation" || name === "subscription") return true;
    } else {
      i++;
    }
  }
  return false;
}

/** Tools that change data, for the startup log. */
export function enabledWriteTools(config: Config): string[] {
  return TOOLS.filter((t) => t.kind !== "read" && isEnabled(t, config)).map((t) => t.name);
}
