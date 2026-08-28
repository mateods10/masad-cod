type AdminGraphql = { graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response> };

export async function publishAppSetting(admin: AdminGraphql, key: string, value: object) {
  const installationResponse = await admin.graphql(`#graphql
    query MasadCurrentInstallation { currentAppInstallation { id } }
  `);
  const installationBody = (await installationResponse.json()) as { data?: { currentAppInstallation?: { id: string } }; errors?: Array<{ message: string }> };
  const ownerId = installationBody.data?.currentAppInstallation?.id;
  if (!ownerId) throw new Error(installationBody.errors?.map((error) => error.message).join("; ") || "No se encontró la instalación de la app");

  const response = await admin.graphql(`#graphql
    mutation MasadPublishSetting($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) { userErrors { field message } }
    }
  `, { variables: { metafields: [{ ownerId, namespace: "masad_cod", key, type: "json", value: JSON.stringify(value) }] } });
  const body = (await response.json()) as { data?: { metafieldsSet?: { userErrors?: Array<{ message: string }> } }; errors?: Array<{ message: string }> };
  const errors = [...(body.errors ?? []), ...(body.data?.metafieldsSet?.userErrors ?? [])];
  if (errors.length) throw new Error(errors.map((error) => error.message).join("; "));
}
