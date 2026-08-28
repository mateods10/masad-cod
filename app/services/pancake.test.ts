import type { CartSession } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { encryptCredential } from "./credentials.server";
import { sendRecoveryViaPancake } from "./pancake.server";

describe("Pancake WhatsApp recovery", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.PANCAKE_CREDENTIALS_KEY;
  });

  it("uses Pancake's page endpoint and WhatsApp template schema", async () => {
    process.env.PANCAKE_CREDENTIALS_KEY = "test-only-key";
    const fetchMock = vi.fn(async () => Response.json({ success: true, id: "message-1" }));
    vi.stubGlobal("fetch", fetchMock);

    const cart = {
      id: "cart-1",
      shop: "luminos-korean-2.myshopify.com",
      recoveryToken: "recover-1",
      phoneNormalized: "+593998483960",
    } as CartSession;

    const result = await sendRecoveryViaPancake(cart, {
      pancakeMode: "api",
      pancakeEndpoint: null,
      pancakePageId: "waba_948808404976725",
      pancakeAccessToken: encryptCredential("page-token"),
      pancakeTemplateId: "template-123",
    });

    expect(result).toMatchObject({ status: "SENT", providerId: "message-1" });
    const [requestUrl, request] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(requestUrl.toString()).toBe(
      "https://pages.fm/api/public_api/v1/pages/waba_948808404976725/conversations/waba_948808404976725_593998483960/messages?page_access_token=page-token",
    );
    expect(JSON.parse(String(request.body))).toEqual({
      action: "reply_inbox",
      conversation_id: "waba_948808404976725_593998483960",
      template_id: "template-123",
      template_params: {
        BODY_PARAMS: {
          "1": "https://luminos-korean-2.myshopify.com/apps/global-aura-recovery/recover/recover-1",
        },
      },
    });
  });
});
