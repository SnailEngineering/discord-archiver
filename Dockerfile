FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application code
COPY . .

# Create reports directory
RUN mkdir -p reports

# Default command (can be overridden)
CMD ["npm", "start"]
