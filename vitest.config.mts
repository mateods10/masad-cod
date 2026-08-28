export default {
  test: {
    include: ["app/**/*.test.ts"],
    environment: "node",
    env: {
      DATABASE_URL: "file:./dev.sqlite",
    },
  },
};
