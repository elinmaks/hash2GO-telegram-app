export class VisualizationManager {
  constructor() {
    this.svg = document.getElementById('rewardChart');
    this.createHashNotificationContainer();
    this.currentNotification = null;
  }

  createHashNotificationContainer() {
    const container = document.createElement('div');
    container.style.cssText = `
      position: fixed;
      bottom: 70px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 1000;
      pointer-events: none;
    `;
    container.id = 'hashNotificationContainer';
    document.body.appendChild(container);
  }

  updateChart(data) {
    if (!this.svg) return;
    
    // Clear previous chart
    this.svg.innerHTML = '';

    const width = this.svg.clientWidth;
    const height = this.svg.clientHeight;
    const padding = 40;

    // Calculate total rewards for percentages
    const totalRewards = data.miners.reduce((sum, m) => sum + m.reward, 0);

    // Create bars
    let currentX = padding;
    const barWidth = (width - padding * 2) / data.miners.length;
    
    data.miners.forEach((miner, i) => {
      const percentage = (miner.reward / totalRewards) * 100;
      const barHeight = ((height - padding * 2) * percentage) / 100;
      
      // Create bar
      const bar = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      bar.setAttribute("x", currentX);
      bar.setAttribute("y", height - padding - barHeight);
      bar.setAttribute("width", barWidth - 10);
      bar.setAttribute("height", barHeight);
      bar.setAttribute("fill", i === 0 ? "#50a8eb" : "#3d7eaf");
      
      // Add hover effect
      bar.addEventListener('mouseover', () => this.showTooltip(miner, currentX, height - padding - barHeight));
      bar.addEventListener('mouseout', () => this.hideTooltip());
      
      this.svg.appendChild(bar);
      
      // Add label
      const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
      text.textContent = `${percentage.toFixed(1)}%`;
      text.setAttribute("x", currentX + (barWidth - 10) / 2);
      text.setAttribute("y", height - padding / 2);
      text.setAttribute("text-anchor", "middle");
      text.setAttribute("font-size", "12px");
      text.setAttribute("fill", "#fff");
      
      this.svg.appendChild(text);
      
      currentX += barWidth;
    });
  }

  updateDifficultyChart(blockTimes, targetTime) {
    return; // Safely disable this feature for now
  }

  showTooltip(miner, x, y) {
    if (!this.svg) return;
    
    const tooltip = document.createElementNS("http://www.w3.org/2000/svg", "g");
    tooltip.setAttribute("id", "tooltip");
    
    const background = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    background.setAttribute("x", x - 5);
    background.setAttribute("y", y - 40);
    background.setAttribute("width", "120");
    background.setAttribute("height", "35");
    background.setAttribute("fill", "rgba(36, 47, 61, 0.9)");
    background.setAttribute("rx", "5");
    
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", x + 5);
    text.setAttribute("y", y - 20);
    text.setAttribute("fill", "#fff");
    text.setAttribute("font-size", "12px");
    text.textContent = `${miner.name}: ${miner.reward.toFixed(2)}`;
    
    tooltip.appendChild(background);
    tooltip.appendChild(text);
    this.svg.appendChild(tooltip);
  }

  hideTooltip() {
    if (!this.svg) return;
    
    const tooltip = document.getElementById("tooltip");
    if (tooltip) {
      tooltip.remove();
    }
  }

  showValidHash(details) {
    if (details.isBlockComplete) {
      this.showBlockNotification(details.reward);
    }
  }

  showBlockNotification(reward) {
    const container = document.getElementById('hashNotificationContainer');
    if (!container) return;
    
    if (this.currentNotification) {
      this.currentNotification.remove();
    }
    
    const notification = document.createElement('div');
    notification.style.cssText = `
      background: rgba(255, 189, 46, 0.1);
      border: 1px solid rgba(255, 189, 46, 0.2);
      color: #ffbd2e;
      padding: 8px 16px;
      border-radius: 4px;
      font-size: 12px;
      margin-bottom: 8px;
      text-align: center;
      animation: fadeInOut 2s forwards;
    `;
    notification.textContent = `Block complete! Reward: ${reward.toFixed(2)} MNG`;
    
    container.appendChild(notification);
    this.currentNotification = notification;
    
    setTimeout(() => {
      if (notification === this.currentNotification) {
        notification.remove();
        this.currentNotification = null;
      }
    }, 2000);
  }
}