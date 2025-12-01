FROM node:20-alpine

WORKDIR /app

COPY package.json ./

RUN npm install

COPY . .

RUN npm run build

EXPOSE 5173

CMD ["npx", "serve", "dist", "-l", "5173"]

