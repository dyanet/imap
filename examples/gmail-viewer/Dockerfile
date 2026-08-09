# Node 22 (Maintenance LTS), not 20 -- Node 20 reached end of life in 2026
# and shouldn't be the base for an image that gets deployed.
#
# Build stage
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies from npm registry
RUN npm ci --registry=https://registry.npmjs.org

# Copy source code
COPY tsconfig.json ./
COPY src ./src

# Issue #23: this image used to go straight from source to a published
# artifact with nothing verifying it. `verify` type-checks the sources
# under the project's own tsconfig without emitting, so a type error fails
# the image build here rather than at runtime on the server.
#
# It is deliberately a separate step from the build below: `npm run build`
# emits, and a failure there is ambiguous between "bad types" and "bad
# tsconfig/output". This step answers the first question on its own.
RUN npm run verify

# Build TypeScript
RUN npm run build

# Production stage
FROM node:22-alpine

WORKDIR /app

# Copy package files and install production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev --registry=https://registry.npmjs.org

# Copy built files from builder
COPY --from=builder /app/dist ./dist

# Expose port
EXPOSE 3000

# Start the server
CMD ["node", "dist/server.js"]
