import { APP_DESCRIPTION, APP_NAME } from "@/lib/constants";
import { ImageResponse } from "next/og";

// Runs on the default Node.js runtime: next@16.3 rejects the `runtime` segment
// config when `cacheComponents` is enabled, and the Edge Runtime is deprecated.
// APP_NAME is also used in JSX below; export...from avoids an intermediate const.
export { APP_NAME as alt } from "@/lib/constants";

export const size = { width: 1200, height: 630 };

export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    <div
      style={{
        height: "100%",
        width: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#09090b",
        padding: "60px",
      }}
    >
      <p
        style={{
          fontSize: 18,
          fontWeight: 600,
          letterSpacing: "0.15em",
          textTransform: "uppercase",
          color: "#71717a",
          marginBottom: "16px",
          marginTop: "0px",
        }}
      >
        Environment Governance CLI
      </p>
      <h1
        style={{
          fontSize: 72,
          fontWeight: 700,
          color: "#fafafa",
          lineHeight: 1.1,
          textAlign: "center",
          maxWidth: "900px",
          margin: "0 0 24px 0",
        }}
      >
        {APP_NAME}
      </h1>
      <p
        style={{
          fontSize: 22,
          color: "#a1a1aa",
          textAlign: "center",
          maxWidth: "700px",
          lineHeight: 1.5,
          margin: "0px",
        }}
      >
        {APP_DESCRIPTION}
      </p>
    </div>,
    size,
  );
}
