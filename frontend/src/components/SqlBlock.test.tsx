import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SqlBlock } from "./ui";

describe("SQL code display", () => {
  it("highlights SQL syntax, preserves line numbers and treats SQL as text", () => {
    render(
      <SqlBlock
        label="Expected SQL"
        sql={[
          "SELECT SUM(o.total_amount) AS revenue",
          "FROM orders o",
          "WHERE o.created_at >= '2024-09-01' -- user input",
          "AND o.region_id = [region_id]",
        ].join("\n")}
      />,
    );

    const code = screen.getByLabelText("Expected SQL");
    expect(code.querySelectorAll(".line-no")).toHaveLength(4);
    expect(code.querySelector(".sql-keyword")?.textContent).toBe("SELECT");
    expect(code.querySelector(".sql-function")?.textContent).toBe("SUM");
    expect(code.querySelector(".sql-string")?.textContent).toBe("'2024-09-01'");
    expect(code.querySelector(".sql-comment")?.textContent).toBe(
      "-- user input",
    );
    expect(code.querySelector(".sql-quoted-identifier")?.textContent).toBe(
      "[region_id]",
    );
    expect(code.querySelector("img")).toBeNull();
  });

  it("does not interpret markup embedded in generated SQL", () => {
    render(<SqlBlock sql="SELECT '<img src=x onerror=alert(1)>' AS value" />);

    expect(screen.getByLabelText("SQL").textContent).toContain(
      "'<img src=x onerror=alert(1)>'",
    );
    expect(document.querySelector("img")).toBeNull();
  });

  it("formats compact SQL for display but copies the untouched source", async () => {
    const sql =
      "SELECT region, SUM(amount) AS revenue FROM sales WHERE month = '2024-09'";
    const user = userEvent.setup();
    const write = vi.spyOn(navigator.clipboard, "writeText");
    render(<SqlBlock sql={sql} />);

    expect(
      screen.getByLabelText("SQL").querySelectorAll(".sql-line"),
    ).toHaveLength(5);
    await user.click(screen.getByRole("button", { name: "Copy SQL" }));
    expect(write).toHaveBeenCalledWith(sql);
  });
});
