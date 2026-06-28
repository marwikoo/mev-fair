import { useEffect, useRef } from "react";
import * as d3 from "d3";

const STAGES = ["INGEST", "PARSE", "CFL", "SCORE", "JUDGE", "REBATE", "APPEAL"];

/**
 * D3 horizontal pipeline diagram. Seven stage nodes on a cyan→magenta rail,
 * with a marker that travels the rail on a loop (the bundle progressing).
 */
export function StageFlow() {
  const ref = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    const svg = d3.select(ref.current);
    svg.selectAll("*").remove();
    const W = 920;
    const H = 130;
    const padX = 40;
    const y = 56;
    svg.attr("viewBox", `0 0 ${W} ${H}`).attr("preserveAspectRatio", "xMidYMid meet");

    const defs = svg.append("defs");
    const grad = defs
      .append("linearGradient")
      .attr("id", "railg")
      .attr("x1", "0")
      .attr("x2", "1");
    grad.append("stop").attr("offset", "0%").attr("stop-color", "#00d4ff");
    grad.append("stop").attr("offset", "55%").attr("stop-color", "#7a4fff");
    grad.append("stop").attr("offset", "100%").attr("stop-color", "#ff006e");

    const x = d3.scalePoint().domain(STAGES).range([padX, W - padX]);

    // rail
    svg
      .append("line")
      .attr("x1", padX)
      .attr("x2", W - padX)
      .attr("y1", y)
      .attr("y2", y)
      .attr("stroke", "url(#railg)")
      .attr("stroke-width", 2)
      .attr("opacity", 0.55);

    // nodes
    const g = svg
      .selectAll("g.node")
      .data(STAGES)
      .enter()
      .append("g")
      .attr("transform", (d) => `translate(${x(d)},${y})`);
    g.append("circle")
      .attr("r", 8)
      .attr("fill", "#060f24")
      .attr("stroke", "#00d4ff")
      .attr("stroke-width", 1.6);
    g.append("circle").attr("r", 3).attr("fill", "#00d4ff");
    g.append("text")
      .attr("y", 28)
      .attr("text-anchor", "middle")
      .attr("fill", "#8595ac")
      .attr("font-family", "JetBrains Mono, monospace")
      .attr("font-size", 10)
      .attr("letter-spacing", "0.12em")
      .text((d) => d);

    // travelling marker
    const marker = svg
      .append("circle")
      .attr("r", 5)
      .attr("cy", y)
      .attr("fill", "#eaf2ff")
      .attr("filter", "drop-shadow(0 0 6px #00d4ff)");

    let stopped = false;
    function loop() {
      if (stopped) return;
      marker
        .attr("cx", padX)
        .attr("opacity", 0)
        .transition()
        .duration(300)
        .attr("opacity", 1)
        .transition()
        .duration(3600)
        .ease(d3.easeCubicInOut)
        .attr("cx", W - padX)
        .transition()
        .duration(300)
        .attr("opacity", 0)
        .on("end", loop);
    }
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) loop();

    return () => {
      stopped = true;
      svg.selectAll("*").interrupt();
    };
  }, []);

  return <svg ref={ref} style={{ width: "100%", height: "auto", display: "block" }} aria-hidden="true" />;
}
