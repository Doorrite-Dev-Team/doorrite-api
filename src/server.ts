import { PORT } from '@config/env';
import { app } from './app';

app.listen(PORT, () => {
  console.log(`🚀 Server listening on http://localhost: ${PORT}`);
  console.log(`Swagger Docs Available at http://localhost:${PORT}/api-docs`);
  
});

