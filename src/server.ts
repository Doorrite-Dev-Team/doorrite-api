import { PORT } from "@config/env";
import { app } from "./app";
import { attachSocketServer } from "./config/socket";

// Attach socket server to the Express app and start the resulting HTTP server
const { server, io } = attachSocketServer(app);

server.listen(PORT, () => {
  console.log(`🚀 Server listening on http://localhost:${PORT}`);
  console.log(`Swagger Docs Available at http://localhost:${PORT}/api-docs`);
});

export { server, io };
