import { Router, type IRouter } from "express";
import healthRouter from "./health";
import notesRouter from "./notes";
import storageRouter from "./storage";
import geminiRouter from "./gemini/index";
import analyticsRouter from "./analytics";
import settingsRouter from "./settings";

const router: IRouter = Router();

router.use(healthRouter);
router.use(notesRouter);
router.use(storageRouter);
router.use(geminiRouter);
router.use(analyticsRouter);
router.use(settingsRouter);

export default router;
