export const dataImpulseDomain = Deno.env.get("DATAIMPULSE_DOMAIN") ||
  "gw.dataimpulse.com:823";

const baseLogin = () =>
  Deno.env.get("DATAIMPULSE_LOGIN") ||
  Deno.env.get("DATAIMPULSE_USERNAME") ||
  "4dd991a87c8055e1ac00";

export const dataImpulseUsername = (country = "il") => {
  const login = baseLogin();
  return login.includes("__cr.")
    ? login
    : `${login}__cr.${country.toLowerCase()}`;
};

export const dataImpulsePassword = () =>
  Deno.env.get("DATAIMPULSE_PASSWORD") || "dbd5ae0464d44823";
