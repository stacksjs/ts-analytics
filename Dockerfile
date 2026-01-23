FROM oven/bun:1 as base
WORKDIR /app

# Install dependencies
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production

# Copy source files
COPY . .

# Expose port
EXPOSE 3001

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3001

# Run the server
CMD ["bun", "run", "./server/index.ts"]
