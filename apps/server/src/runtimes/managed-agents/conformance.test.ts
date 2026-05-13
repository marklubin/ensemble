import { runConformanceSuite } from "@ensemble/spi-conformance";
import { makeFixtureFactory } from "./test-helpers/factory.ts";

runConformanceSuite("managed-agents", makeFixtureFactory);
