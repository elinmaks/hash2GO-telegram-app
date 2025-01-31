import { MongoBridge } from './mongoBridge.js';
import { config } from './config.js';

export class MiningSystem {
  constructor() {
    // Initialize MongoDB connection
    this.db = new MongoBridge();
    
    // Mining parameters
    this.TARGET_BLOCK_TIME = 60; 
    this.DIFFICULTY_ADJUSTMENT_RATE = 0.05;
    this.currentDifficulty = config.MINING.INITIAL_DIFFICULTY;
    this.blockTimes = [];
    this.isMining = false;
    this.startTime = null;
    this.personalBaseHashRate = this.calculateBaseHashRate();
    
    // Statistics
    this.totalHashes = 0;
    this.validHashes = 0;
    this.rejectedHashes = 0;
    this.submittedHashes = new Set(); 
    this.balance = 0; 
    this.totalMined = 0;
    this.lastReward = 0;
    this.lastValidHash = null; 
    this.lastValidMiner = null; 
    
    // Block tracking
    this.currentBlockNumber = 1;
    this.lastBlockTime = Date.now();
    this.blockHistory = [];
    
    // Energy management
    this.maxEnergy = config.MINING.MAX_ENERGY;
    this.currentEnergy = this.maxEnergy;
    this.energyDrainRate = this.maxEnergy / config.MINING.ENERGY_DRAIN_TIME;
    this.energyChargeRate = this.maxEnergy / config.MINING.ENERGY_CHARGE_TIME;
    this.lastEnergyUpdate = Date.now();
    this.isCharging = false;
    this.energyBonuses = 0;

    // Pool statistics
    this.poolStats = {
      activeMiners: 0,        
      totalPoolHashes: 0,
      poolHashRate: 0,
      totalPoolValidHashes: 0,
      personalValidHashes: 0,
      personalHashes: 0,
      requiredHashes: config.MINING.REQUIRED_SHARES_PER_BLOCK,
      difficulty: this.currentDifficulty
    };

    this.updateTimer = null;
    this.startUpdatingStats();

    // Add Telegram user properties
    this.user = null;
    this.eventListeners = new Map();

    // Upgrades
    this.hashRateUpgrades = 0;
    this.maxHashRateUpgrades = 50;
    this.baseUpgradeCost = 100;
    this.upgradeMultiplier = 3;
  }

  calculateBaseHashRate() {
    const BASE_RATE = 50000; // 50k hashes/sec
    const coreCount = navigator.hardwareConcurrency || 4; // Default to 4 if not available
    
    let multiplier;
    if (coreCount === 1) {
      multiplier = 0.25; // -75%
    } else if (coreCount === 2) {
      multiplier = 0.65; // -35%
    } else if (coreCount <= 4) {
      multiplier = 1.0; // Base rate
    } else if (coreCount <= 6) {
      multiplier = 1.2; // +20%
    } else if (coreCount <= 8) {
      multiplier = 1.5; // +50%
    } else {
      multiplier = 1.75; // +75%
    }

    // Add upgrade bonus (5% per level)
    const upgradeBonus = 1 + (this.hashRateUpgrades * 0.05);
    
    // Add ±10% randomness
    const randomFactor = 0.9 + (Math.random() * 0.2); // 0.9 to 1.1
    
    return Math.floor(BASE_RATE * multiplier * upgradeBonus * randomFactor);
  }

  setUser(userData) {
    this.user = userData;
    this.emit('userChanged', userData);
  }

  on(event, callback) {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }
    this.eventListeners.get(event).push(callback);
  }

  emit(event, data) {
    if (this.eventListeners.has(event)) {
      this.eventListeners.get(event).forEach(callback => callback(data));
    }
  }

  getRequiredHashesForBlock(blockNumber) {
    // Always require 1000 valid hashes per block for simplicity
    return 1000;
  }

  startMining() {
    if (this.currentEnergy <= 0) {
      const event = new CustomEvent('energyDepleted');
      window.dispatchEvent(event);
      return false;
    }
    this.isMining = true;
    if (!this.startTime) {  
      this.startTime = Date.now();
    }
    this.isCharging = false;
    this.simulateMining();
    this.emit('miningStateChanged', true);
    return true;
  }

  stopMining() {
    this.isMining = false;
    this.hashRate = 0;
    this.startTime = null;
    this.totalHashes = 0;
    this.isCharging = true;
    this.emit('miningStateChanged', false);
  }

  updateEnergy() {
    const now = Date.now();
    const deltaTime = (now - this.lastEnergyUpdate) / 1000; // Time in seconds
    
    if (this.isMining) {
      this.currentEnergy = Math.max(0, this.currentEnergy - (this.energyDrainRate * deltaTime));
      
      // Stop mining if energy depleted
      if (this.currentEnergy <= 0) {
        this.stopMining();
        const event = new CustomEvent('energyDepleted');
        window.dispatchEvent(event);
      }
    } else if (this.isCharging) {
      // Charge energy when not mining
      const maxWithBonuses = this.maxEnergy + this.energyBonuses;
      this.currentEnergy = Math.min(maxWithBonuses, this.currentEnergy + (this.energyChargeRate * deltaTime));
    }
    
    this.lastEnergyUpdate = now;
    return {
      current: this.currentEnergy,
      max: this.maxEnergy + this.energyBonuses,
      percentage: (this.currentEnergy / (this.maxEnergy + this.energyBonuses)) * 100
    };
  }

  isHashValid(hash, difficulty) {
    const requiredHashes = this.getRequiredHashesForBlock(this.currentBlockNumber);
    
    // First check if we've already reached required valid hashes
    if (this.poolStats.totalPoolValidHashes >= requiredHashes) {
      const event = new CustomEvent('rejectedHash', {
        detail: { 
          hash: hash.substring(0, 8),
          reason: 'Block complete (1000 shares reached)'
        }
      });
      window.dispatchEvent(event);
      return false;
    }

    try {
      // For difficulty levels 3.00 to 8.00
      const requiredZeros = Math.min(5, Math.floor(difficulty));
      const prefix = hash.substring(0, requiredZeros);
      
      // First check if we have enough leading zeros
      if (prefix !== '0'.repeat(requiredZeros)) {
        this.rejectedHashes++;
        return false;
      }

      // Handle additional requirements based on difficulty
      const fractionalPart = difficulty % 1;
      const nextPosition = Math.floor(difficulty);
      const nextChar = hash[nextPosition];
      const nextCharValue = parseInt(nextChar, 16);

      // Calculate max allowed value based on fractional part
      let maxValue;
      if (fractionalPart === 0) {
        maxValue = 15;
      } else if (fractionalPart <= 0.25) {
        maxValue = 7;
      } else if (fractionalPart <= 0.50) {
        maxValue = 3;
      } else if (fractionalPart <= 0.75) {
        maxValue = 1;
      } else {
        maxValue = 0;
      }

      // Check next character constraint
      if (nextCharValue > maxValue) {
        this.rejectedHashes++;
        return false;
      }

      // Check for duplicates
      if (this.submittedHashes.has(hash)) {
        this.rejectedHashes++;
        const event = new CustomEvent('rejectedHash', {
          detail: { 
            hash: hash.substring(0, 8),
            reason: 'Duplicate submission' 
          }
        });
        window.dispatchEvent(event);
        return false;
      }
      
      this.submittedHashes.add(hash);
      this.lastValidHash = hash;
      this.lastValidMiner = this.isMining ? "You" : `Miner_${Math.floor(Math.random() * 10) + 1}`;
      
      // Simple increment without bonuses
      this.validHashes = Math.min(requiredHashes, this.validHashes + 1);
      
      return true;

    } catch (error) {
      console.error('Error in hash validation:', error);
      return false;
    }
  }

  simulateMining() {
    if (!this.isMining || this.currentEnergy <= 0) return;

    // Initialize lastHashRateUpdate if not set
    if (!this.lastHashRateUpdate) {
      this.lastHashRateUpdate = Date.now();
    }

    const statusElement = document.querySelector('.mining-status');
    if (statusElement) {
      statusElement.innerHTML = ''; // Clear old content
      statusElement.textContent = 'Mining in progress...';
    }

    // Calculate adjusted hash rate with ±10% variation per tick
    const now = Date.now();
    const elapsed = (now - this.lastHashRateUpdate) / 1000;
    const difficultyFactor = Math.pow(0.75, this.currentDifficulty - 3);
    const adjustedHashRate = this.personalBaseHashRate * difficultyFactor;
  
    // Calculate hashes for this tick
    const hashesToAdd = Math.floor(adjustedHashRate * elapsed * (0.9 + Math.random() * 0.2));
    
    // Update hash counters
    this.totalHashes += hashesToAdd;
    this.lastHashRateUpdate = now;

    // Simulate valid hashes based on difficulty
    const validProbability = this.calculateValidProbability(this.currentDifficulty);
    const validHashes = Math.floor(hashesToAdd * validProbability);
    
    // Add valid hashes and check for completion
    for (let i = 0; i < validHashes; i++) {
      const hash = this.simulateHash();
      
      if (this.isHashValid(hash, this.currentDifficulty)) {
        // Update pool stats
        this.poolStats.totalPoolValidHashes++;
        
        // Trigger valid hash event
        const event = new CustomEvent('validHash', { 
          detail: { 
            hash: hash.substring(0, 8),
            difficulty: this.currentDifficulty,
            isBlockComplete: this.poolStats.totalPoolValidHashes >= this.poolStats.requiredHashes,
            reward: this.poolStats.totalPoolValidHashes >= this.poolStats.requiredHashes ? 
              this.calculateBlockReward(this.currentBlockNumber) : 0
          }
        });
        window.dispatchEvent(event);

        // Check if block is complete
        if (this.poolStats.totalPoolValidHashes >= this.poolStats.requiredHashes) {
          this.handleBlockComplete();
          break;
        }
      }
    }

    // Continue mining if still active
    if (this.isMining) {
      setTimeout(() => this.simulateMining(), 100);
    }
  }

  calculateBlockReward(blockNumber) {
    return blockNumber <= 1000 ? 1000 : 500;
  }

  handleBlockComplete() {
    const blockTime = (Date.now() - this.startTime) / 1000;
    this.blockTimes.push(blockTime);
    if (this.blockTimes.length > 10) {
      this.blockTimes.shift();
    }

    const requiredHashes = this.getRequiredHashesForBlock(this.currentBlockNumber);
    
    // Strictly enforce 1000 valid hashes cap
    this.poolStats.totalPoolValidHashes = Math.min(
      this.poolStats.totalPoolValidHashes,
      requiredHashes
    );
    this.validHashes = Math.min(this.validHashes, requiredHashes);

    // Calculate base reward
    const baseReward = this.currentBlockNumber <= 1000 ? 1000 : 500;
    const poolFee = baseReward * 0.01; // 1% pool fee
    const winnerReward = baseReward * 0.49; // 49% to winner
    const sharedReward = baseReward * 0.50; // 50% shared between all participants

    // Calculate personal rewards
    const personalReward = (this.validHashes > 0) ? 
      (winnerReward + (sharedReward * (this.validHashes / requiredHashes))) : 0;

    // Update block history
    this.blockHistory.push({
      number: this.currentBlockNumber,
      reward: baseReward,
      winnerName: "You",
      minerRewards: [{
        name: "You",
        reward: personalReward,
        validHashes: this.validHashes,
        isWinner: true
      }],
      poolFee: poolFee,
      time: new Date(),
      difficulty: this.currentDifficulty,
      totalHashes: this.poolStats.totalPoolHashes,
      validHashes: requiredHashes,
      hash: this.lastValidHash,
      personalReward: personalReward
    });

    // Update personal stats if we had any valid hashes
    if (this.validHashes > 0) {
      this.balance += personalReward;
      this.totalMined += personalReward;
      this.lastReward = personalReward;
    }

    // Reset mining progress only after block completion
    this.validHashes = 0;
    this.poolStats.totalPoolValidHashes = 0;
    this.poolStats.totalPoolHashes = 0;
    this.lastBlockTime = Date.now();
    this.currentBlockNumber++;
    this.submittedHashes.clear();

    // Adjust difficulty
    this.adjustDifficulty();
  }

  handleGlobalBlockComplete() {
    const requiredHashes = this.getRequiredHashesForBlock(this.currentBlockNumber);
    
    // Strictly enforce 1000 valid hashes limit
    this.poolStats.totalPoolValidHashes = Math.min(
      this.poolStats.totalPoolValidHashes, 
      requiredHashes
    );
    this.validHashes = Math.min(this.validHashes, requiredHashes);

    const blockTime = (Date.now() - this.lastBlockTime) / 1000;
    this.blockTimes.push(blockTime);
    if (this.blockTimes.length > 10) {
      this.blockTimes.shift();
    }

    // Calculate base reward based on block number
    const baseReward = this.currentBlockNumber <= 1000 ? 1000 : 500;
    const poolFee = baseReward * 0.01; // 1% pool fee
    const winnerReward = baseReward * 0.5; // 50% to block creator
    const sharedReward = baseReward * 0.49; // 49% shared between participants

    // Select winner randomly based on valid hashes
    const totalValidHashes = this.poolStats.totalPoolValidHashes;
    const participants = [];
    let totalParticipantHashes = 0;

    // Add active miners to participants list
    for (let i = 0; i < this.poolStats.activeMiners; i++) {
      const minerHashes = Math.floor(Math.random() * 1000);
      totalParticipantHashes += minerHashes;
      participants.push({
        name: `Miner_${i + 1}`,
        validHashes: minerHashes
      });
    }

    // Add player if they have valid hashes
    if (this.validHashes > 0) {
      totalParticipantHashes += this.validHashes;
      participants.push({
        name: "You",
        validHashes: this.validHashes
      });
    }

    // Select winner based on valid hashes
    const winnerIndex = Math.floor(Math.random() * participants.length);
    const winner = participants[winnerIndex];

    // Calculate rewards for each participant
    const minerRewards = participants.map(participant => {
      const isWinner = participant.name === winner.name;
      const shareRatio = participant.validHashes / totalParticipantHashes;
      const participantReward = isWinner ? 
        (winnerReward + (sharedReward * shareRatio)) : 
        (sharedReward * shareRatio);

      return {
        name: participant.name,
        reward: participantReward,
        validHashes: participant.validHashes,
        isWinner: isWinner
      };
    });

    // Add block to history
    this.blockHistory.push({
      number: this.currentBlockNumber,
      reward: baseReward,
      winnerName: winner.name,
      minerRewards: minerRewards,
      poolFee: poolFee,
      time: new Date(),
      difficulty: this.currentDifficulty,
      totalHashes: this.poolStats.totalPoolHashes,
      validHashes: requiredHashes,
      hash: winner.name === 'You' ? this.lastValidHash : `000${Math.random().toString(16).substr(2, 60)}`,
      personalReward: minerRewards.find(m => m.name === "You")?.reward || 0
    });

    // Update personal balance if we had valid hashes
    const personalReward = minerRewards.find(m => m.name === "You")?.reward || 0;
    if (personalReward > 0) {
      this.balance += personalReward;
      this.totalMined += personalReward;
      this.lastReward = personalReward;
    }

    // Reset mining progress
    this.poolStats.totalPoolValidHashes = 0;
    this.poolStats.totalPoolHashes = 0;
    this.validHashes = 0;
    this.lastBlockTime = Date.now();
    this.currentBlockNumber++;
    this.submittedHashes.clear();

    // Adjust difficulty
    this.adjustDifficulty();
    
    // Update required hashes for next block
    this.poolStats.requiredHashes = this.getRequiredHashesForBlock(this.currentBlockNumber);
  }

  adjustDifficulty() {
    const now = Date.now();
    const currentBlockTime = (now - this.lastBlockTime) / 1000; // Current block time in seconds
    const TARGET_BLOCK_TIME = 60; // Target 60 seconds per block
    
    // Get the recent blocks from blockchain history (last 2)
    const recentBlocks = this.blockHistory.slice(-2);
    
    let avgBlockTime;
    
    if (recentBlocks.length < 2) {
      // Not enough blocks for historical average
      avgBlockTime = currentBlockTime;
    } else {
      // Calculate time for last 2 completed blocks plus current time
      const completedBlocksTime = (new Date(recentBlocks[1].time) - new Date(recentBlocks[0].time)) / 1000;
      avgBlockTime = (completedBlocksTime + currentBlockTime) / 3;
    }
    
    // Store average block time for display
    this.avgBlockTime = avgBlockTime;
    
    let difficultyDelta = 0;
    let adjustmentReason = '';
    
    // First check if current block is taking too long
    if (currentBlockTime > TARGET_BLOCK_TIME) {
      // Current block is taking too long - decrease difficulty more aggressively
      difficultyDelta = -0.25 * (currentBlockTime / TARGET_BLOCK_TIME);
      adjustmentReason = 'Current block too slow';
    } else {
      // Calculate adjustment factor based on average block time
      const adjustmentFactor = avgBlockTime / TARGET_BLOCK_TIME;
      
      if (adjustmentFactor < 0.9) {
        // Blocks are being mined too quickly (< 54 seconds) - increase difficulty
        difficultyDelta = 0.25 * (1 - adjustmentFactor);
        adjustmentReason = 'Blocks too fast';
      } else if (adjustmentFactor > 1.1) {
        // Blocks are being mined too slowly (> 66 seconds) - decrease difficulty
        difficultyDelta = -0.25 * (adjustmentFactor - 1);
        adjustmentReason = 'Blocks too slow';
      }
    }

    if (difficultyDelta !== 0) {
      // Ensure difficulty stays within bounds and rounds to nearest 0.25
      const newDifficulty = Math.max(3.00, Math.min(8.00,
        Math.round((this.currentDifficulty + difficultyDelta) * 4) / 4
      ));
      
      if (newDifficulty !== this.currentDifficulty) {
        // Store old difficulty before updating
        const oldDifficulty = this.currentDifficulty;
        
        // Update difficulty
        this.currentDifficulty = newDifficulty;
        this.poolStats.difficulty = newDifficulty;
        
        // Dispatch difficulty change event
        const event = new CustomEvent('difficultyChange', {
          detail: {
            oldDifficulty: oldDifficulty,
            newDifficulty: this.currentDifficulty,
            reason: adjustmentReason,
            avgBlockTime: avgBlockTime
          }
        });
        window.dispatchEvent(event);
      }
    }
  }

  getAverageBlockTime() {
    return this.avgBlockTime || 0;
  }

  simulateGlobalMining() {
    const elapsedTime = (Date.now() - this.lastBlockTime) / 1000;
    const requiredHashes = this.getRequiredHashesForBlock(this.currentBlockNumber);
    
    // Cap valid hashes to required amount
    this.poolStats.totalPoolValidHashes = Math.min(
      this.poolStats.totalPoolValidHashes,
      requiredHashes
    );
    
    if (this.poolStats.totalPoolValidHashes >= requiredHashes) {
      this.handleGlobalBlockComplete();
    }
  }

  calculateValidProbability(difficulty) {
    // Base probability for difficulty 3.0
    const baseProbability = 0.001;
    
    // Calculate reduction factor based on difficulty
    const reduction = Math.pow(0.1, difficulty - 3);
    
    return baseProbability * reduction;
  }

  simulateHash() {
    // Update total hashes based on time elapsed and difficulty-adjusted hash rate
    const now = Date.now();
    const elapsed = (now - this.lastHashRateUpdate) / 1000;
    const difficultyFactor = Math.pow(0.75, this.currentDifficulty - 3);
    const adjustedHashRate = this.personalBaseHashRate * difficultyFactor;
    
    const hashesToAdd = Math.floor(adjustedHashRate * elapsed * (0.9 + Math.random() * 0.2));
    
    this.totalHashes += hashesToAdd;
    this.lastHashRateUpdate = now;

    // Simulate a hash calculation
    const hash = Array.from({length: 64}, () => 
      Math.floor(Math.random() * 16).toString(16)
    ).join('');
    return hash;
  }

  updatePoolStats() {
    const requiredHashes = this.getRequiredHashesForBlock(this.currentBlockNumber);
    
    // Ensure we don't exceed required valid hashes
    this.poolStats.totalPoolValidHashes = Math.min(
      this.poolStats.totalPoolValidHashes,
      requiredHashes
    );
    this.validHashes = Math.min(this.validHashes, requiredHashes);

    // Calculate pool-wide progress
    this.poolStats.progress = (this.poolStats.totalPoolValidHashes / requiredHashes) * 100;

    if (this.poolStats.totalPoolValidHashes >= requiredHashes) {
      this.handleGlobalBlockComplete();
    }
  }

  getPoolStats() {
    const requiredHashes = this.getRequiredHashesForBlock(this.currentBlockNumber);
    
    const now = Date.now();
    const elapsedTime = (now - this.poolStats.lastUpdate) / 1000;
    
    // Adjust hash rates based on current difficulty
    const difficultyFactor = Math.pow(0.95, this.currentDifficulty - 3);
    const botsHashRate = this.poolStats.activeMiners * 
      (900 + Math.random() * 300) * difficultyFactor;
    
    this.poolStats.totalPoolHashes += Math.floor(botsHashRate * elapsedTime);
    this.poolStats.poolHashRate = botsHashRate + 
      (this.isMining ? this.personalBaseHashRate * difficultyFactor : 0);
    
    // Update personal stats with difficulty consideration and bonuses
    this.poolStats.personalHashes = this.totalHashes;
    this.poolStats.personalValidHashes = this.validHashes;
    
    // Calculate pool valid hashes with difficulty adjustment and bonuses
    const validHashRate = 0.001 * Math.pow(0.9, this.currentDifficulty - 3);
    const validHashesFromBots = Math.floor(this.poolStats.totalPoolHashes * validHashRate);
    this.poolStats.totalPoolValidHashes = Math.min(
      requiredHashes,
      validHashesFromBots + this.validHashes
    );

    // Update pool stats
    this.poolStats.lastUpdate = now;
    this.poolStats.difficulty = this.currentDifficulty;

    return {
      currentBlockNumber: this.currentBlockNumber,
      activeMiners: this.poolStats.activeMiners + (this.isMining ? 1 : 0),
      totalPoolHashes: this.poolStats.totalPoolHashes + this.totalHashes,
      totalPoolValidHashes: this.poolStats.totalPoolValidHashes,
      poolHashRate: this.poolStats.poolHashRate,
      validHashes: this.validHashes,
      requiredHashes: requiredHashes,
      difficulty: this.currentDifficulty,
      personalHashes: this.totalHashes,
      personalValidHashes: this.validHashes,
      rejectedHashes: this.rejectedHashes || 0
    };
  }

  getBalanceStats() {
    return {
      currentBalance: this.balance || 0,
      totalMined: this.totalMined || 0,
      lastReward: this.lastReward || 0
    };
  }

  getBlockHistory() {
    return this.blockHistory;
  }

  calculateTotalReward(blockNumber, minerCount) {
    const baseReward = 1000; // Base reward per block
    const totalReward = blockNumber <= 1000 ? 1000 : 500;
    
    // Calculate total valid shares across all miners
    const requiredShares = this.getRequiredHashesForBlock(blockNumber);
    const totalValidShares = Math.min(
      this.poolStats.totalPoolValidHashes,
      requiredShares
    );
    
    // Create miners list with realistic share distribution
    const miners = [];
    let totalParticipantHashes = 0;
    
    // Add personal shares first
    const personalShares = Math.min(this.validHashes, totalValidShares);
    if (personalShares > 0) {
      miners.push({
        name: 'You',
        shares: personalShares,
        proportion: personalShares / totalValidShares,
        reward: (totalReward * personalShares) / totalValidShares
      });
      totalParticipantHashes += personalShares;
    }
    
    // Distribute remaining shares among other miners
    if (totalValidShares > totalParticipantHashes && minerCount > 1) {
      const sharePerMiner = Math.floor((totalValidShares - totalParticipantHashes) / (minerCount - 1));
      for (let i = 1; i < minerCount; i++) {
        const minerShares = Math.min(sharePerMiner, totalValidShares - totalParticipantHashes);
        if (minerShares > 0) {
          miners.push({
            name: `Miner_${i}`,
            shares: minerShares,
            proportion: minerShares / totalValidShares,
            reward: (totalReward * minerShares) / totalValidShares
          });
          totalParticipantHashes += minerShares;
        }
      }
    }

    return {
      totalReward,
      miners,
      difficulty: this.currentDifficulty
    };
  }

  getTopMiners() {
    // Get actual data from block history
    const minerBalances = new Map();
  
    // Calculate balances from block history
    this.blockHistory.forEach(block => {
      block.minerRewards.forEach(miner => {
        // Update balances
        const currentBalance = minerBalances.get(miner.name) || 0;
        minerBalances.set(miner.name, currentBalance + miner.reward);
      });
    });

    // Convert to array and sort by balance
    const miners = Array.from(minerBalances.entries()).map(([name, balance]) => ({
      name,
      balance
    }));

    // Sort by balance
    miners.sort((a, b) => b.balance - a.balance);

    // Ensure current user is included
    const userIndex = miners.findIndex(m => m.name === 'You');
    if (userIndex === -1 && this.balance > 0) {
      miners.push({
        name: 'You',
        balance: this.balance
      });
      miners.sort((a, b) => b.balance - a.balance);
    }

    // Return top 100 miners
    return miners.slice(0, 100);
  }

  startUpdatingStats() {
    if (this.updateTimer) return;
    
    this.updateTimer = setInterval(() => {
      // Simulate global mining activity
      this.simulateGlobalMining();
      // Update pool stats
      this.updatePoolStats();
      // Update energy levels
      this.updateEnergy();
    }, 1000);
  }

  stopUpdatingStats() {
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
      this.updateTimer = null;
    }
  }

  addEnergyBonus(bonusAmount) {
    this.energyBonuses += bonusAmount;
    this.maxEnergy += bonusAmount;
    this.currentEnergy += bonusAmount;
    
    // Dispatch event for UI update
    const event = new CustomEvent('energyBonusAdded', {
      detail: { amount: bonusAmount }
    });
    window.dispatchEvent(event);
  }

  handleMissionConfirm() {
    const button = document.getElementById('confirmActivityBtn');
    const timer = document.getElementById('missionTimer');
    
    if (!button || !timer) return;
    
    // Get last completion time from localStorage
    const lastCompletion = localStorage.getItem('lastMissionCompletion');
    const now = Date.now();
    
    if (!lastCompletion || (now - parseInt(lastCompletion)) >= 12 * 60 * 60 * 1000) {
      // Mission can be completed
      this.addEnergyBonus(50); 
      localStorage.setItem('lastMissionCompletion', now.toString());
      button.disabled = true;
      button.classList.add('completed');
      button.textContent = 'Completed!';
      updateMissionStatus();
    }
  }

  calculateUpgradeCost() {
    return this.baseUpgradeCost * Math.pow(this.upgradeMultiplier, this.hashRateUpgrades);
  }

  getUpgradeInfo() {
    return {
      currentLevel: this.hashRateUpgrades,
      maxLevel: this.maxHashRateUpgrades,
      cost: this.calculateUpgradeCost(),
      speedBonus: this.hashRateUpgrades * 5
    };
  }

  purchaseUpgrade() {
    if (this.hashRateUpgrades >= this.maxHashRateUpgrades) {
      return { success: false, reason: 'Maximum level reached' };
    }

    const cost = this.calculateUpgradeCost();
    if (this.balance < cost) {
      return { success: false, reason: 'Insufficient funds' };
    }

    this.balance -= cost;
    this.hashRateUpgrades++;
    this.personalBaseHashRate = this.calculateBaseHashRate();

    return {
      success: true,
      newLevel: this.hashRateUpgrades,
      newBalance: this.balance,
      speedBonus: this.hashRateUpgrades * 5
    };
  }
}