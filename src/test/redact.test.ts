// @vitest-environment node
import { describe, expect, it } from "vitest";

import { describeError } from "@/lib/error-capture";
import { errorFields } from "@/backend/log.server";
import { redactQueryParams } from "@/lib/redact";

describe("keeping customer details out of the logs", () => {
  const leaky = new Error(
    "Failed query: insert into orders (email, access_token) values ($1, $2)\nparams: ada@example.com,tSECRETTOKEN,line one\nline two of an address",
  );

  it("cuts the values out of a failed query but keeps the SQL", () => {
    const text = redactQueryParams(leaky.message);
    expect(text).toContain("insert into orders (email, access_token) values ($1, $2)");
    expect(text).not.toContain("ada@example.com");
    expect(text).not.toContain("tSECRETTOKEN");
    expect(text).not.toContain("line two");
  });

  it("applies to the message, the stack and expanded error chains", () => {
    const fields = errorFields(leaky);
    expect(JSON.stringify(fields)).not.toContain("tSECRETTOKEN");
    const chained = new Error("outer", { cause: leaky });
    expect(describeError(chained)).not.toContain("tSECRETTOKEN");
    expect(describeError(chained)).toContain("outer");
  });

  it("leaves ordinary messages alone", () => {
    expect(redactQueryParams("connect ECONNREFUSED 127.0.0.1:5432")).toBe(
      "connect ECONNREFUSED 127.0.0.1:5432",
    );
  });
});
