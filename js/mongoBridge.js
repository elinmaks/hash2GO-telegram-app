export class MongoBridge {
  constructor() {
    this.localData = {
      users: new Map(),
      blocks: [],
      shares: []
    };
  }

  async connect() {
    // In real implementation, connect to MongoDB here
    return true;
  }

  async saveUser(userData) {
    const { telegramId, username, balance, totalShares, totalBlocks } = userData;
    this.localData.users.set(telegramId, {
      telegramId,
      username,
      balance,
      totalShares,
      totalBlocks,
      lastUpdate: new Date()
    });
  }

  async getUser(telegramId) {
    return this.localData.users.get(telegramId) || null;
  }

  async saveBlock(blockData) {
    this.localData.blocks.push({
      ...blockData,
      timestamp: new Date()
    });
  }

  async getNetworkStats() {
    const totalUsers = this.localData.users.size;
    const totalBlocks = this.localData.blocks.length;
    const totalMined = this.localData.blocks.reduce(
      (sum, block) => sum + block.reward, 
      0
    );

    return {
      totalUsers,
      totalBlocks,
      totalMined
    };
  }
}