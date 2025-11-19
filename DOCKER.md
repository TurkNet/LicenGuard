# Docker Setup and Usage Guide

This documentation provides instructions for running the LicenGuard project using Docker.

## Overview

LicenGuard is a monorepo that inventories internal OSS dependencies (C#, Node.js, Python, Java, etc.), stores their license metadata in MongoDB, exposes a Python API, React dashboard, and optional MCP server for AI copilots.

## Prerequisites

- Docker (20.10+)
- Docker Compose (2.0+)

## Quick Start

### Start All Services

```bash
# Start all services (MongoDB, Backend, Frontend, MCP Server)
docker-compose up -d
```

After starting, the services will be available at:
- **Frontend**: http://localhost:5173
- **Backend API**: http://localhost:4000
- **MCP Server**: http://localhost:3333/mcp
- **MongoDB**: localhost:27017

### Stop Services

```bash
# Stop all services
docker-compose down

# Stop and remove volumes (deletes database data)
docker-compose down -v
```

## Services

### 1. MongoDB (mongo)

- **Image**: `mongo:6`
- **Container Name**: `licenguard-mongo`
- **Port**: 27017
- **Database**: licenguard
- **Volume**: `mongo-data` (persistent data storage)
- **Health Check**: Enabled with MongoDB ping command

### 2. Backend API (api)

- **Container Name**: `licenguard-api`
- **Port**: 4000
- **URL**: http://localhost:4000
- **Health Check**: http://localhost:4000/health
- **Technology**: FastAPI (Python 3.11)
- **Dependencies**: MongoDB
- **Build Context**: `./backend`

### 3. Frontend Web (web)

- **Container Name**: `licenguard-web`
- **Port**: 5173
- **URL**: http://localhost:5173
- **Technology**: React (Node.js 20)
- **Dependencies**: Backend API
- **Build Context**: `./apps/web`
- **Build Args**: `API_URL` (default: http://localhost:4000)

### 4. MCP Server (mcp)

- **Container Name**: `licenguard-mcp`
- **Port**: 3333
- **URL**: http://localhost:3333/mcp
- **Technology**: Node.js 20
- **Dependencies**: Backend API
- **Build Context**: `./servers/mcp-licenguard`

## Environment Variables

### Backend (.env file)

Create `backend/.env` file:

```env
MONGODB_URI=mongodb://mongo:27017/licenguard
MONGODB_DB=licenguard
MCP_HTTP_URL=http://mcp:3333/mcp
```

**Note**: The docker-compose.yml already sets these values, but you can override them via `.env` file.

### Frontend

The frontend API URL is determined at build time. To change it:

```bash
docker-compose build --build-arg API_URL=http://your-api-url:4000 web
```

Or create `apps/web/.env` file (if your build process supports it).

### MCP Server

The MCP server environment variables are configured in `docker-compose.yml`:

- `API_URL`: http://api:4000
- `MCP_HTTP_ENABLED`: true
- `MCP_HTTP_PORT`: 3333
- `MCP_HTTP_HOST`: 0.0.0.0
- `MCP_HTTP_PATH`: /mcp
- `MCP_STDIO_ENABLED`: false
- `MCP_AUTO_IMPORT`: false
- `RESPONSE_LANGUAGE`: Turkish

To override these, modify the `docker-compose.yml` file or use environment variables.

## Build Operations

### Build Individual Services

```bash
# Backend
docker-compose build api

# Frontend
docker-compose build web

# MCP Server
docker-compose build mcp
```

### Build All Services

```bash
docker-compose build
```

### Rebuild Without Cache

```bash
docker-compose build --no-cache
```

## Viewing Logs

```bash
# All services logs
docker-compose logs -f

# Specific service logs
docker-compose logs -f api
docker-compose logs -f web
docker-compose logs -f mongo
docker-compose logs -f mcp
```

## Database Operations

### Seed Data

To populate the database with sample data:

```bash
# Enter the backend container
docker-compose exec api bash

# Run the seed script
python seed.py

# Or run directly without entering container
docker-compose exec api python seed.py
```

### Connect to MongoDB

```bash
# Connect to MongoDB shell
docker-compose exec mongo mongosh licenguard

# Or use MongoDB Compass or any MongoDB client
# Connection string: mongodb://localhost:27017/licenguard
```

### Backup Database

```bash
# Create backup
docker-compose exec mongo mongodump --db licenguard --out /data/backup

# Copy backup from container
docker cp licenguard-mongo:/data/backup ./backup
```

### Restore Database

```bash
# Copy backup to container
docker cp ./backup licenguard-mongo:/data/backup

# Restore
docker-compose exec mongo mongorestore --db licenguard /data/backup/licenguard
```

## Troubleshooting

### Check Service Status

```bash
# View running containers
docker-compose ps

# View detailed status
docker-compose ps -a
```

### Restart Services

```bash
# Restart all services
docker-compose restart

# Restart specific service
docker-compose restart api
docker-compose restart web
docker-compose restart mcp
```

### View Service Health

```bash
# Check health status
docker-compose ps

# Inspect specific container
docker inspect licenguard-api | grep -A 10 Health
```

### Clean Up Containers

```bash
# Stop and remove containers
docker-compose down

# Remove images as well
docker-compose down --rmi all

# Remove volumes (deletes database data)
docker-compose down -v

# Remove everything including images and volumes
docker-compose down --rmi all -v
```

### Clean Up Docker System

```bash
# Remove unused containers, networks, images
docker system prune -f

# Remove all unused data including volumes
docker system prune -a --volumes -f
```

### Common Issues

#### Port Already in Use

If a port is already in use, either:
1. Stop the conflicting service
2. Change the port mapping in `docker-compose.yml`

#### Container Won't Start

```bash
# Check logs
docker-compose logs api

# Check if dependencies are healthy
docker-compose ps

# Restart with fresh build
docker-compose up -d --build
```

#### Database Connection Issues

Ensure MongoDB is healthy before starting the API:
```bash
docker-compose ps mongo
docker-compose logs mongo
```

The API service waits for MongoDB to be healthy before starting (via `depends_on` with health check).

## Production Usage

For production environments:

1. **Secure Environment Variables**: Use Docker secrets or external secret management
2. **Frontend Build**: Set production API URL:
   ```bash
   docker-compose build --build-arg API_URL=https://api.yourdomain.com web
   ```
3. **HTTPS**: Use a reverse proxy (nginx/traefik) for HTTPS termination
4. **MongoDB**: Consider using MongoDB Atlas or a managed MongoDB service with replica sets
5. **Backups**: Set up automated backups for MongoDB volumes
6. **Monitoring**: Add monitoring and logging solutions (Prometheus, Grafana, ELK stack)
7. **Resource Limits**: Add resource limits to services in `docker-compose.yml`:
   ```yaml
   deploy:
     resources:
       limits:
         cpus: '1'
         memory: 1G
   ```

## Network Architecture

All services run on a bridge network named `licenguard-network`. Services can communicate with each other using service names:

- `mongo` - MongoDB database
- `api` - Backend API
- `web` - Frontend application
- `mcp` - MCP Server

**Example**: The backend connects to MongoDB using `mongodb://mongo:27017/licenguard` instead of `localhost`.

## Usage Scenarios

### Start All Services

```bash
# Start all services (MongoDB, Backend, Frontend, MCP Server)
docker-compose up -d
```

### Start Only Backend and MongoDB

```bash
docker-compose up -d mongo api
```

### Start Frontend with Backend (Without MCP)

```bash
docker-compose up -d mongo api web
```

### Start Services in Development Mode

For development with hot-reload, you may want to mount volumes:

```yaml
# Add to docker-compose.yml for development
volumes:
  - ./backend:/app
  - ./apps/web:/app
```

Then restart:
```bash
docker-compose up -d
```

## Dockerfile Details

### Backend Dockerfile

- **Base Image**: `python:3.11-slim`
- **Dependencies**: Installs from `requirements.txt`
- **Health Check**: HTTP check on `/health` endpoint
- **Command**: `uvicorn app.main:app --host 0.0.0.0 --port 4000`

### Frontend Dockerfile

- **Base Image**: `node:20-alpine`
- **Build Process**: Runs `npm run build` with production mode
- **Server**: Uses `serve` to serve static files
- **Build Args**: `API_URL` for API endpoint configuration

### MCP Server Dockerfile

- **Base Image**: `node:20-alpine`
- **Dependencies**: Installs from `package.json`
- **Command**: `node src/index.js`

## Additional Resources

- [Docker Documentation](https://docs.docker.com/)
- [Docker Compose Documentation](https://docs.docker.com/compose/)
- [MongoDB Docker Hub](https://hub.docker.com/_/mongo)
- [FastAPI Documentation](https://fastapi.tiangolo.com/)
- [React Documentation](https://react.dev/)
