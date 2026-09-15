import { describe, expect, it, vi } from "vitest";
import { substituteVars } from "./template-engine";

describe("substituteVars", () => {
  it("fills what it is given", () => {
    expect(substituteVars("Dear {{name}}, {{room_name}}", { name: "Jane", room_name: "Main Room" })).toBe("Dear Jane, Main Room");
  });
  it("blanks a placeholder nobody supplied on a real send, and says so", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(substituteVars("<p> {{member_info}}</p>", { name: "Jane" })).toBe("<p> </p>");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("member_info"));
    warn.mockRestore();
  });
  it("keeps it visible for the editor's preview", () => {
    expect(substituteVars("<p>{{member_infoo}}</p>", { member_info: "x" }, "keep")).toBe("<p>{{member_infoo}}</p>");
  });
  it("an empty value is an empty string, not the placeholder", () => {
    expect(substituteVars("[{{member_info}}]", { member_info: "" })).toBe("[]");
  });
});
