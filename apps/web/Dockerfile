FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package.json ./

# Install dependencies
RUN npm install

# Copy source files
COPY . .

# Build the application
ARG API_URL=http://localhost:4000
ENV API_URL=${API_URL}
ENV NODE_ENV=production

RUN npm run build

EXPOSE 5173

CMD ["npx", "serve", "dist", "-l", "5173"]

