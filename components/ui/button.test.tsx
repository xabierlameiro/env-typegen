import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button, buttonVariants } from "./button";

describe("buttonVariants", () => {
  it("should include base classes for every combination", () => {
    const result = buttonVariants({ variant: "primary", size: "md" });
    expect(result).toContain("inline-flex");
    expect(result).toContain("rounded-md");
    expect(result).toContain("font-medium");
  });

  it("should apply primary variant classes by default", () => {
    const result = buttonVariants({});
    expect(result).toContain("bg-foreground");
    expect(result).toContain("text-background");
  });

  it("should apply secondary variant classes", () => {
    const result = buttonVariants({ variant: "secondary" });
    expect(result).toContain("bg-secondary");
    expect(result).toContain("text-secondary-foreground");
  });

  it("should apply outline variant classes", () => {
    const result = buttonVariants({ variant: "outline" });
    expect(result).toContain("border");
    expect(result).toContain("bg-transparent");
  });

  it("should apply ghost variant classes", () => {
    const result = buttonVariants({ variant: "ghost" });
    expect(result).toContain("bg-transparent");
  });

  it("should apply danger variant classes", () => {
    const result = buttonVariants({ variant: "danger" });
    expect(result).toContain("bg-red-600");
    expect(result).toContain("text-white");
  });

  it("should apply sm size classes", () => {
    const result = buttonVariants({ size: "sm" });
    expect(result).toContain("h-8");
    expect(result).toContain("px-3");
    expect(result).toContain("text-xs");
  });

  it("should apply md size classes by default", () => {
    const result = buttonVariants({});
    expect(result).toContain("h-10");
    expect(result).toContain("px-4");
    expect(result).toContain("text-sm");
  });

  it("should apply lg size classes", () => {
    const result = buttonVariants({ size: "lg" });
    expect(result).toContain("h-12");
    expect(result).toContain("px-6");
    expect(result).toContain("text-base");
  });
});

describe("Button", () => {
  it("should render children", () => {
    render(<Button>Click me</Button>);
    expect(screen.getByRole("button", { name: "Click me" })).toBeDefined();
  });

  it("should apply primary variant classes by default", () => {
    render(<Button>Submit</Button>);
    const button = screen.getByRole("button", { name: "Submit" });
    expect(button.className).toContain("bg-foreground");
  });

  it("should apply secondary variant when specified", () => {
    render(<Button variant="secondary">Cancel</Button>);
    const button = screen.getByRole("button", { name: "Cancel" });
    expect(button.className).toContain("bg-secondary");
  });

  it("should be disabled when isLoading is true", () => {
    render(<Button isLoading>Loading</Button>);
    const button = screen.getByRole("button", { name: /Loading/i });
    expect(button).toHaveProperty("disabled", true);
  });

  it("should set aria-busy when isLoading is true", () => {
    render(<Button isLoading>Loading</Button>);
    const button = screen.getByRole("button", { name: /Loading/i });
    expect(button.getAttribute("aria-busy")).toBe("true");
  });

  it("should render the loading spinner when isLoading is true", () => {
    render(<Button isLoading>Loading</Button>);
    // spinner is aria-hidden
    const spinners = document.querySelectorAll("[aria-hidden='true']");
    expect(spinners.length).toBeGreaterThan(0);
  });

  it("should be disabled when disabled prop is true", () => {
    render(<Button disabled>Action</Button>);
    const button = screen.getByRole("button", { name: "Action" });
    expect(button).toHaveProperty("disabled", true);
  });

  it("should merge custom className with variant classes", () => {
    render(<Button className="custom-class">CTA</Button>);
    const button = screen.getByRole("button", { name: "CTA" });
    expect(button.className).toContain("custom-class");
    expect(button.className).toContain("bg-foreground");
  });

  it("should not show spinner when not loading", () => {
    render(<Button>Submit</Button>);
    const spinners = document.querySelectorAll(".animate-spin");
    expect(spinners).toHaveLength(0);
  });
});
