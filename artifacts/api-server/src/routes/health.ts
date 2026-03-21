import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

router.get("/ip", async (_req, res) => {
  const response = await fetch("https://ifconfig.me/ip");
  const ip = await response.text();
  res.send(ip.trim());
});

export default router;
