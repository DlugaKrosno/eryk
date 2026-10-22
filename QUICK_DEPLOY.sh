#!/bin/bash
# Quick Deploy Script for DrEryk Alert Management
# Usage: ./QUICK_DEPLOY.sh [production|development]

ENVIRONMENT=${1:-production}

echo "🚀 DrEryk Alert Management - Quick Deploy"
echo "=========================================="
echo "Environment: $ENVIRONMENT"
echo ""

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 18+ first."
    exit 1
fi

# Check if Forge CLI is installed
if ! command -v forge &> /dev/null; then
    echo "❌ Forge CLI is not installed. Installing..."
    npm install -g @forge/cli
fi

# Build all components
echo "📦 Building all components..."
npm run build

if [ $? -ne 0 ]; then
    echo "❌ Build failed. Please check the errors above."
    exit 1
fi

echo "✅ Build completed successfully"
echo ""

# Deploy to Forge
echo "🚀 Deploying to Forge ($ENVIRONMENT)..."
if [ "$ENVIRONMENT" == "production" ]; then
    forge deploy --environment production
else
    forge deploy
fi

if [ $? -ne 0 ]; then
    echo "❌ Deployment failed. Please check the errors above."
    exit 1
fi

echo "✅ Deployment completed successfully"
echo ""
echo "📝 Next steps:"
echo "1. Run 'forge install --upgrade' to install/update in your Jira instance"
echo "2. Test the application in your Jira instance"
echo "3. Check logs with 'forge logs' if needed"
echo ""
echo "🎉 Done!"
