import { Router, type IRouter } from "express";
import healthRouter from "./health";
import storageRouter from "./storage";
import usersRouter from "./users";
import projectsRouter from "./projects";
import tracksRouter from "./tracks";
import sequencesRouter from "./sequences";
import shareRouter from "./share";
import teamsRouter from "./teams";
import ogRouter from "./og";

const router: IRouter = Router();

router.use(healthRouter);
router.use(storageRouter);
router.use(usersRouter);
router.use(projectsRouter);
router.use(tracksRouter);
router.use(sequencesRouter);
router.use(shareRouter);
router.use(teamsRouter);
router.use(ogRouter);

export default router;
