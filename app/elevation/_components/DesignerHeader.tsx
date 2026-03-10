"use client";

import type { Config } from "../_lib/types";

interface DesignerHeaderProps {
  config: Config;
  wallW: number;
  overallDepth: number;
  leftReturn: number;
  rightReturn: number;
}

export function DesignerHeader({ config, wallW, overallDepth, leftReturn, rightReturn }: DesignerHeaderProps) {
  return (
    <>
      <h1 style={{ fontSize: "22px", fontWeight: "700", marginBottom: "4px", color: "#111" }}>
        Closet Designer
      </h1>
      <p style={{ fontSize: "14px", color: "#444", marginTop: "0", marginBottom: "4px" }}>
        {wallW}&Prime; wide &nbsp;&middot;&nbsp;
        {overallDepth}&Prime; depth &nbsp;&middot;&nbsp;
        returns: {leftReturn}&Prime; / {rightReturn}&Prime;
      </p>
      {(config.clientName || config.clientNum) && (
        <p style={{ fontSize: "13px", color: "#555", marginTop: "0", marginBottom: "20px" }}>
          {config.clientName && <span>{config.clientName}</span>}
          {config.clientName && config.clientNum && <span> &nbsp;&middot;&nbsp; </span>}
          {config.clientNum && <span>#{config.clientNum}</span>}
        </p>
      )}
      {!config.clientName && !config.clientNum && (
        <div style={{ marginBottom: "20px" }} />
      )}
    </>
  );
}
