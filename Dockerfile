FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
COPY packages/api/package*.json packages/api/
COPY packages/cms/package*.json packages/cms/
COPY packages/shared/package*.json packages/shared/

RUN npm ci

# Copy source
COPY . .

# Build shared types
RUN npm run build -w packages/shared

# Build backend
RUN npm run build -w packages/api

# Expose port
EXPOSE 3001

# Start backend
CMD ["npm", "start", "-w", "packages/api"]
