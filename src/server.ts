import { PORT } from "@config/env";
import { app } from "./app";
import { socketService } from "@config/socket";
import { createServer } from "http";
// Attach socket server to the Express app and start the resulting HTTP server
const server = createServer(app);

socketService.init(server);

server.listen(PORT, () => {
  console.log(`🚀 Server listening on http://localhost:${PORT}`);
  console.log(`Socket is on wsl://localhost:${PORT}`);
  console.log(`Swagger Docs Available at http://localhost:${PORT}/api-docs`);
});

export { server };
