# miru 📊

Investment fund performance analysis for the Turkish market.

## About

This project analyzes investment fund performance using data from TEFAS (Turkey Electronic Fund Trading Platform). It provides tools for comparing funds, calculating financial metrics, and visualizing performance trends.

## Project Structure

```
fonradar/
├── data/           # Raw and processed data
├── notebooks/      # Jupyter notebooks for analysis
├── src/            # Python source code
└── README.md
```

## Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/fonradar.git
cd fonradar

# Create virtual environment (optional but recommended)
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt
```

## Usage

### 1. Fetch Fund Data

```python
from src.tefas_client import TEFASClient

client = TEFASClient()
df = client.get_multiple_funds()
df.to_csv('data/fund_data.csv', index=False)
```

### 2. Run Analysis

Open and run the Jupyter notebooks in the `notebooks/` folder:

```bash
jupyter notebook notebooks/01_data_collection_and_exploration.ipynb
```

## Features

- **Data Collection**: Automated data fetching from TEFAS API
- **Performance Metrics**: Sharpe Ratio, Volatility, Maximum Drawdown
- **Visualization**: Price trends, correlation matrices, risk-return plots
- **Fund Comparison**: Normalized performance comparison across fund types

## Fund Categories

| Category | Description |
|----------|-------------|
| Equity Funds | Invest primarily in BIST stocks |
| Bond Funds | Invest in government and corporate bonds |
| Mixed Funds | Combination of stocks and bonds |
| Gold Funds | Track gold prices |
| Money Market | Short-term, low-risk instruments |

## Technologies

- Python 3.10+
- pandas & numpy
- matplotlib & seaborn
- requests (for API calls)
- Jupyter Notebook

## Roadmap

- [x] Data collection module
- [x] Basic exploratory analysis
- [ ] Advanced financial metrics
- [ ] Machine learning models
- [x] Web dashboard (Next.js frontend over the FastAPI layer)

## Author

[Your Name]

## License

MIT License
