import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { extractUploadedPdf, UploadReadError } from "@/server/extract-upload";
import { createTRPCRouter, publicProcedure } from "@/server/trpc";

export const extractRouter = createTRPCRouter({
  document: publicProcedure
    .input(
      z.object({
        fileName: z.string().trim().min(1).max(255),
        pdfBase64: z.string().min(1).max(30_000_000),
      }),
    )
    .mutation(async ({ input }) => {
      try {
        return await extractUploadedPdf(input);
      } catch (error) {
        if (error instanceof UploadReadError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
        }
        const detail = error instanceof Error ? error.message : "no further detail was available";
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `The document could not be read. ${detail}`,
        });
      }
    }),
});

export const appRouter = createTRPCRouter({
  extract: extractRouter,
});

export type AppRouter = typeof appRouter;
